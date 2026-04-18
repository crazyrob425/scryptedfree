/**
 * Unit tests for the recording.ts shared pipeline.
 *
 * No Scrypted SDK runtime is required; an in-memory SegmentWriter and
 * NullSegmentIndex are used throughout.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  NullSegmentIndex,
  RecordingPipeline,
  type RecordingPipelineOptions,
  type SegmentWriter,
  type SegmentWriterFactory,
} from '../src/recording';
import { type IngestFrame, type IngestSession } from '../src/ingest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFrame(seq: number, timestampMs: number): IngestFrame {
  return {
    data: Buffer.from(`frame-${seq}`),
    meta: { timestampMs, keyframe: seq % 5 === 0, sequence: seq },
  };
}

function makeSession(frames: IngestFrame[], label = 'test-cam'): IngestSession {
  let stopped = false;
  return {
    label,
    async stop() {
      stopped = true;
    },
    async *frames() {
      for (const frame of frames) {
        if (stopped) return;
        yield frame;
      }
    },
  };
}

/** SegmentWriter that accumulates written data in memory. */
class MemoryWriter implements SegmentWriter {
  readonly chunks: Buffer[] = [];
  closed = false;
  async write(data: Buffer) { this.chunks.push(data); }
  async close() { this.closed = true; }
}

/** Factory that returns one MemoryWriter per filePath. */
function makeWriterFactory(): { factory: SegmentWriterFactory; writers: Map<string, MemoryWriter> } {
  const writers = new Map<string, MemoryWriter>();
  const factory: SegmentWriterFactory = async (filePath: string) => {
    const w = new MemoryWriter();
    writers.set(filePath, w);
    return w;
  };
  return { factory, writers };
}

function baseOpts(extra?: Partial<RecordingPipelineOptions>): RecordingPipelineOptions {
  return {
    outputDir: '/tmp/rec-test',
    index: new NullSegmentIndex(),
    console: undefined,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Segment creation
// ---------------------------------------------------------------------------

describe('RecordingPipeline segment creation', () => {
  it('writes a single segment when all frames fit within the duration', async () => {
    const t0 = 1_000_000;
    const frames = [makeFrame(0, t0), makeFrame(1, t0 + 1_000), makeFrame(2, t0 + 2_000)];
    const session = makeSession(frames);
    const { factory, writers } = makeWriterFactory();

    const pipeline = new RecordingPipeline(
      session,
      baseOpts({ retention: { segmentDurationMs: 60_000 } }),
      factory,
    );
    await pipeline.start();

    const segments = pipeline.getSegments();
    assert.equal(segments.length, 1);
    assert.equal(segments[0].open, false);
    assert.equal(segments[0].deviceLabel, 'test-cam');
    assert.equal(writers.size, 1);

    const [writer] = writers.values();
    assert.equal(writer.chunks.length, 3);
    assert.equal(writer.closed, true);
  });

  it('rotates into a new segment when segmentDurationMs is exceeded', async () => {
    const t0 = 1_000_000;
    // segmentDurationMs = 1 000 ms; third frame starts a new segment
    const frames = [
      makeFrame(0, t0),
      makeFrame(1, t0 + 500),
      makeFrame(2, t0 + 1_500), // exceeds 1 s boundary → new segment
      makeFrame(3, t0 + 2_000),
    ];
    const session = makeSession(frames);
    const { factory, writers } = makeWriterFactory();

    const pipeline = new RecordingPipeline(
      session,
      baseOpts({ retention: { segmentDurationMs: 1_000 } }),
      factory,
    );
    await pipeline.start();

    const segments = pipeline.getSegments();
    assert.equal(segments.length, 2);
    assert.equal(writers.size, 2);
  });

  it('accumulates sizeBytes correctly', async () => {
    const t0 = 1_000_000;
    const frames = [makeFrame(0, t0), makeFrame(1, t0 + 1_000)];
    const session = makeSession(frames);
    const { factory } = makeWriterFactory();

    const pipeline = new RecordingPipeline(session, baseOpts(), factory);
    await pipeline.start();

    const total = pipeline.totalBytes();
    const expected = frames.reduce((s, f) => s + f.data.byteLength, 0);
    assert.equal(total, expected);
  });
});

// ---------------------------------------------------------------------------
// Retention / pruning
// ---------------------------------------------------------------------------

describe('RecordingPipeline retention', () => {
  it('prunes segments older than maxAgeMs', async () => {
    const nowMs = Date.now();
    const index = new NullSegmentIndex();
    // Pre-populate index with two old sealed segments
    await index.save([
      {
        id: 'old-1',
        deviceLabel: 'cam',
        startMs: nowMs - 10_000_000,
        endMs: nowMs - 9_000_000,
        sizeBytes: 100,
        filePath: '/tmp/old-1.bin',
      },
      {
        id: 'old-2',
        deviceLabel: 'cam',
        startMs: nowMs - 5_000,
        endMs: nowMs - 4_000,
        sizeBytes: 50,
        filePath: '/tmp/old-2.bin',
      },
    ]);

    const session = makeSession([]); // no new frames
    const { factory } = makeWriterFactory();
    const pipeline = new RecordingPipeline(
      session,
      baseOpts({
        index,
        retention: { maxAgeMs: 60_000, segmentDurationMs: 60_000 },
      }),
      factory,
    );
    await pipeline.start();

    // Only the recent segment should survive
    const segments = pipeline.getSegments();
    assert.equal(segments.length, 1);
    assert.equal(segments[0].id, 'old-2');
  });

  it('prunes oldest segments when maxTotalBytes is exceeded', async () => {
    const nowMs = Date.now();
    const index = new NullSegmentIndex();
    await index.save([
      { id: 'seg-a', deviceLabel: 'cam', startMs: nowMs - 3_000, endMs: nowMs - 2_000, sizeBytes: 40, filePath: '/tmp/a.bin' },
      { id: 'seg-b', deviceLabel: 'cam', startMs: nowMs - 2_000, endMs: nowMs - 1_000, sizeBytes: 40, filePath: '/tmp/b.bin' },
      { id: 'seg-c', deviceLabel: 'cam', startMs: nowMs - 1_000, endMs: nowMs, sizeBytes: 40, filePath: '/tmp/c.bin' },
    ]);

    const session = makeSession([]);
    const { factory } = makeWriterFactory();
    const pipeline = new RecordingPipeline(
      session,
      baseOpts({ index, retention: { maxTotalBytes: 70, maxAgeMs: 1_000_000 } }),
      factory,
    );
    await pipeline.start();

    // 120 total → must drop oldest until ≤ 70 → drop seg-a (40), still 80 → drop seg-b (40) → 40 ≤ 70
    const ids = pipeline.getSegments().map(s => s.id);
    assert.ok(!ids.includes('seg-a'));
    assert.ok(!ids.includes('seg-b'));
    assert.ok(ids.includes('seg-c'));
  });
});

// ---------------------------------------------------------------------------
// Crash-safe recovery (index persistence)
// ---------------------------------------------------------------------------

describe('RecordingPipeline crash recovery', () => {
  it('persists segments to the index after sealing', async () => {
    const t0 = 1_000_000;
    const frames = [makeFrame(0, t0)];
    const session = makeSession(frames);
    const index = new NullSegmentIndex();
    const { factory } = makeWriterFactory();

    const pipeline = new RecordingPipeline(
      session,
      baseOpts({ index, retention: { segmentDurationMs: 60_000 } }),
      factory,
    );
    await pipeline.start();

    const saved = await index.load();
    assert.equal(saved.length, 1);
    assert.equal(saved[0].deviceLabel, 'test-cam');
  });

  it('restores segments from a prior index on start', async () => {
    const nowMs = Date.now();
    const index = new NullSegmentIndex();
    await index.save([
      { id: 'prior-seg', deviceLabel: 'cam', startMs: nowMs - 1_000, endMs: nowMs - 500, sizeBytes: 10, filePath: '/tmp/prior.bin' },
    ]);

    const session = makeSession([]); // no new frames
    const { factory } = makeWriterFactory();
    const pipeline = new RecordingPipeline(
      session,
      baseOpts({ index, retention: { maxAgeMs: 1_000_000 } }),
      factory,
    );
    await pipeline.start();

    const ids = pipeline.getSegments().map(s => s.id);
    assert.ok(ids.includes('prior-seg'), 'prior segment should be restored');
  });
});

// ---------------------------------------------------------------------------
// stop()
// ---------------------------------------------------------------------------

describe('RecordingPipeline stop()', () => {
  it('seals the current segment when stopped early', async () => {
    const t0 = 1_000_000;
    let infiniteStopped = false;
    const infiniteSession: IngestSession = {
      label: 'infinite-cam',
      async stop() { infiniteStopped = true; },
      async *frames() {
        let seq = 0;
        while (!infiniteStopped) {
          yield makeFrame(seq++, t0 + seq * 100);
          // Yield to the event loop so that stop() can be processed.
          await new Promise(r => setImmediate(r));
        }
      },
    };
    const { factory } = makeWriterFactory();
    const pipeline = new RecordingPipeline(
      infiniteSession,
      baseOpts({ retention: { segmentDurationMs: 60_000 } }),
      factory,
    );

    // Start in background, let a few frames arrive, then stop.
    const prom = pipeline.start();
    await new Promise(r => setTimeout(r, 20));
    await pipeline.stop();
    await prom;

    const segs = pipeline.getSegments();
    assert.ok(segs.length >= 1);
    assert.equal(segs.at(-1)!.open, false);
  });
});
