/**
 * Shared recording pipeline: segment management, retention policy, and
 * crash-safe recovery.
 *
 * Providers plug in via `IngestSession`. The pipeline writes segments,
 * enforces retention, and can resume after a crash using an on-disk index.
 */

import { IngestSession } from './ingest';

// ---------------------------------------------------------------------------
// Segment
// ---------------------------------------------------------------------------

/** An individual recording segment produced by the pipeline. */
export interface RecordingSegment {
  /** Unique stable ID (e.g. derived from start timestamp). */
  id: string;
  /** Camera / device label from the ingest session. */
  deviceLabel: string;
  /** Wall-clock start time (ms since epoch). */
  startMs: number;
  /** Wall-clock end time (ms since epoch) — set once the segment is sealed. */
  endMs?: number;
  /** Estimated size in bytes. */
  sizeBytes: number;
  /** Absolute path to the on-disk segment file. */
  filePath: string;
  /** true while the pipeline is actively writing to this segment. */
  open: boolean;
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/** Policy governing how long / how much to keep on disk. */
export interface RetentionPolicy {
  /**
   * Maximum age of a sealed segment before it is eligible for pruning (ms).
   * Defaults to 7 days.
   */
  maxAgeMs?: number;
  /**
   * Maximum total storage across all segments in bytes.
   * When exceeded the oldest sealed segments are pruned first.
   * Defaults to 50 GB.
   */
  maxTotalBytes?: number;
  /**
   * Ideal segment duration before the pipeline seals and rotates (ms).
   * Defaults to 60 seconds.
   */
  segmentDurationMs?: number;
}

// ---------------------------------------------------------------------------
// Index (crash-safe recovery)
// ---------------------------------------------------------------------------

/** Persisted record for one segment, used to rebuild state after a crash. */
export interface SegmentIndexEntry {
  id: string;
  deviceLabel: string;
  startMs: number;
  endMs?: number;
  sizeBytes: number;
  filePath: string;
}

/** Minimal persistence contract so the pipeline can be tested without FS. */
export interface SegmentIndex {
  load(): Promise<SegmentIndexEntry[]>;
  save(entries: SegmentIndexEntry[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export interface RecordingPipelineOptions {
  /** Where to write segment files. */
  outputDir: string;
  /** Governs storage cleanup. */
  retention?: RetentionPolicy;
  /** Crash-safe index backend. Provide `NullSegmentIndex` in tests. */
  index?: SegmentIndex;
  /** Used for status / error output. */
  console?: Console;
}

/**
 * Describes the write operation the pipeline delegates to the host.
 *
 * The real implementation would use `fs.WriteStream`; tests can use an in-
 * memory buffer by supplying a `SegmentWriter` factory.
 */
export interface SegmentWriter {
  write(data: Buffer): Promise<void>;
  close(): Promise<void>;
}

/**
 * Factory that turns a file path into a `SegmentWriter`.
 * Defaults to the built-in no-op writer; tests or hosts substitute a real one.
 */
export type SegmentWriterFactory = (filePath: string) => Promise<SegmentWriter>;

/** No-op writer used when no factory is supplied. */
const noopWriter: SegmentWriterFactory = async () => ({
  write: async () => {},
  close: async () => {},
});

// ---------------------------------------------------------------------------
// NullSegmentIndex — useful for testing
// ---------------------------------------------------------------------------

export class NullSegmentIndex implements SegmentIndex {
  private entries: SegmentIndexEntry[] = [];

  async load(): Promise<SegmentIndexEntry[]> {
    return [...this.entries];
  }

  async save(entries: SegmentIndexEntry[]): Promise<void> {
    this.entries = [...entries];
  }
}

// ---------------------------------------------------------------------------
// RecordingPipeline
// ---------------------------------------------------------------------------

/**
 * Consumes frames from an `IngestSession`, writes them to segment files,
 * enforces retention policy, and can recover an existing partial segment
 * after a crash by re-reading the index.
 */
export class RecordingPipeline {
  private segments: RecordingSegment[] = [];
  private currentSegment: RecordingSegment | undefined;
  private currentWriter: SegmentWriter | undefined;
  private running = false;
  private stopped = false;

  private readonly retention: Required<RetentionPolicy>;
  private readonly index: SegmentIndex;
  private readonly writerFactory: SegmentWriterFactory;
  private readonly console: Console;

  constructor(
    private readonly session: IngestSession,
    private readonly opts: RecordingPipelineOptions,
    writerFactory?: SegmentWriterFactory,
  ) {
    this.index = opts.index ?? new NullSegmentIndex();
    this.writerFactory = writerFactory ?? noopWriter;
    this.console = opts.console ?? (globalThis as any).console;
    this.retention = {
      maxAgeMs: opts.retention?.maxAgeMs ?? 7 * 24 * 60 * 60 * 1_000,
      maxTotalBytes: opts.retention?.maxTotalBytes ?? 50 * 1024 * 1024 * 1024,
      segmentDurationMs: opts.retention?.segmentDurationMs ?? 60_000,
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Recover any open segment from a previous run, then start consuming
   * frames until the session ends or `stop()` is called.
   */
  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;

    await this.recover();

    try {
      for await (const frame of this.session.frames()) {
        if (this.stopped) {
          break;
        }
        await this.handleFrame(frame.data, frame.meta.timestampMs);
      }
    } catch (err) {
      this.console.error(`[recording] session error for "${this.session.label}"`, err);
    } finally {
      await this.sealCurrentSegment();
      this.running = false;
    }
  }

  /** Gracefully stop the pipeline and seal the current segment. */
  async stop(): Promise<void> {
    this.stopped = true;
    await this.session.stop();
    await this.sealCurrentSegment();
  }

  /** All segments known to the pipeline, ordered oldest-first. */
  getSegments(): ReadonlyArray<RecordingSegment> {
    return this.segments;
  }

  /** Total bytes across all segments (including the open one). */
  totalBytes(): number {
    return this.segments.reduce((sum, s) => sum + s.sizeBytes, 0);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private async recover(): Promise<void> {
    const entries = await this.index.load();
    for (const entry of entries) {
      this.segments.push({
        ...entry,
        open: false,
      });
    }
    if (entries.length > 0) {
      this.console.log(
        `[recording] recovered ${entries.length} segment(s) for "${this.session.label}"`,
      );
    }
    await this.pruneExpired();
  }

  private async handleFrame(data: Buffer, timestampMs: number): Promise<void> {
    if (!this.currentSegment) {
      await this.openNewSegment(timestampMs);
    }

    // Rotate if the current segment has exceeded its target duration.
    const seg = this.currentSegment!;
    if (timestampMs - seg.startMs >= this.retention.segmentDurationMs) {
      await this.sealCurrentSegment();
      await this.openNewSegment(timestampMs);
    }

    await this.currentWriter!.write(data);
    this.currentSegment!.sizeBytes += data.byteLength;
  }

  private async openNewSegment(startMs: number): Promise<void> {
    const id = `${this.session.label}-${startMs}`;
    const filePath = `${this.opts.outputDir}/${id}.bin`;
    const writer = await this.writerFactory(filePath);

    const segment: RecordingSegment = {
      id,
      deviceLabel: this.session.label,
      startMs,
      sizeBytes: 0,
      filePath,
      open: true,
    };

    this.currentSegment = segment;
    this.currentWriter = writer;
    this.segments.push(segment);
    await this.persistIndex();
  }

  private async sealCurrentSegment(): Promise<void> {
    if (!this.currentSegment || !this.currentWriter) {
      return;
    }
    const seg = this.currentSegment;
    seg.endMs = Date.now();
    seg.open = false;
    await this.currentWriter.close();
    this.currentSegment = undefined;
    this.currentWriter = undefined;
    await this.pruneExpired();
    await this.persistIndex();
  }

  /** Remove segments that exceed age or total-size limits. */
  private async pruneExpired(): Promise<void> {
    const nowMs = Date.now();
    const cutoffMs = nowMs - this.retention.maxAgeMs;

    // Age-based prune
    this.segments = this.segments.filter(s => {
      const ts = s.endMs ?? s.startMs;
      return ts >= cutoffMs;
    });

    // Size-based prune (oldest sealed first)
    const sorted = [...this.segments]
      .filter(s => !s.open)
      .sort((a, b) => a.startMs - b.startMs);

    while (this.totalBytes() > this.retention.maxTotalBytes && sorted.length > 0) {
      const victim = sorted.shift()!;
      this.segments = this.segments.filter(s => s.id !== victim.id);
    }
  }

  private async persistIndex(): Promise<void> {
    const entries: SegmentIndexEntry[] = this.segments.map(s => ({
      id: s.id,
      deviceLabel: s.deviceLabel,
      startMs: s.startMs,
      endMs: s.endMs,
      sizeBytes: s.sizeBytes,
      filePath: s.filePath,
    }));
    await this.index.save(entries);
  }
}
