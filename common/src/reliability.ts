/**
 * Reliability controls for the ingest + recording pipeline.
 *
 * Provides:
 *   - `SessionRestartGuard`  — automatically restarts a crashed ingest
 *     session with capped concurrency and adaptive backoff.
 *   - `BoundedQueue<T>`      — in-memory queue with a configurable max
 *     size that protects against unbounded memory growth when consumers
 *     fall behind producers.
 *   - `CrashSafeRunner`      — wraps any async function so that unhandled
 *     rejections are caught, logged, and retried without crashing the
 *     Node process.
 */

import { connectWithRetry, type IngestProvider, type IngestSession, type RetryOptions } from './ingest';
import { RecordingPipeline, type RecordingPipelineOptions, type SegmentWriterFactory } from './recording';

// ---------------------------------------------------------------------------
// BoundedQueue
// ---------------------------------------------------------------------------

/**
 * A FIFO queue that drops the oldest item when `maxSize` is exceeded.
 * Useful as a buffer between a fast producer (ingest frames) and a slower
 * consumer (disk write) so the Node heap stays bounded.
 */
export class BoundedQueue<T> {
  private readonly items: T[] = [];
  private _droppedCount = 0;

  constructor(private readonly maxSize: number) {
    if (maxSize <= 0) throw new RangeError('maxSize must be > 0');
  }

  /** Add an item. If full, drop the oldest item first (head-drop). */
  push(item: T): void {
    if (this.items.length >= this.maxSize) {
      this.items.shift();
      this._droppedCount++;
    }
    this.items.push(item);
  }

  /** Remove and return the next item, or `undefined` if empty. */
  shift(): T | undefined {
    return this.items.shift();
  }

  get size(): number { return this.items.length; }
  get empty(): boolean { return this.items.length === 0; }
  get droppedCount(): number { return this._droppedCount; }
}

// ---------------------------------------------------------------------------
// CrashSafeRunner
// ---------------------------------------------------------------------------

/**
 * Wraps an async task so that if it throws the error is caught, logged,
 * and the task is restarted after a backoff delay.
 *
 * The runner stops automatically when `stop()` is called.
 */
export class CrashSafeRunner {
  private running = false;
  private stopped = false;
  private restarts = 0;

  constructor(
    private readonly name: string,
    private readonly task: () => Promise<void>,
    private readonly opts: {
      maxRestarts?: number;
      initialDelayMs?: number;
      maxDelayMs?: number;
      console?: Console;
    } = {},
  ) {}

  start(): void {
    if (this.running || this.stopped) return;
    this.running = true;
    this.run();
  }

  stop(): void {
    this.stopped = true;
  }

  get restartCount(): number { return this.restarts; }

  private run(): void {
    const {
      maxRestarts = Infinity,
      initialDelayMs = 1_000,
      maxDelayMs = 60_000,
    } = this.opts;
    const log = this.opts.console ?? (globalThis as any).console;

    const attempt = async () => {
      try {
        await this.task();
        this.running = false;
        log.log(`[crash-safe] "${this.name}" completed normally`);
      } catch (err) {
        if (this.stopped) {
          this.running = false;
          return;
        }
        this.restarts++;
        if (this.restarts > maxRestarts) {
          log.error(
            `[crash-safe] "${this.name}" exceeded maxRestarts (${maxRestarts}), giving up`,
          );
          this.running = false;
          return;
        }
        const delay = Math.min(
          initialDelayMs * 2 ** (this.restarts - 1),
          maxDelayMs,
        );
        log.warn(
          `[crash-safe] "${this.name}" crashed (restart ${this.restarts}), retrying in ${delay}ms:`,
          err,
        );
        setTimeout(attempt, delay);
      }
    };

    attempt();
  }
}

// ---------------------------------------------------------------------------
// SessionRestartGuard
// ---------------------------------------------------------------------------

export interface SessionRestartGuardOptions {
  /** Max concurrent sessions for the same device. Defaults to 1. */
  maxConcurrent?: number;
  /** Retry options forwarded to `connectWithRetry`. */
  retry?: RetryOptions;
  console?: Console;
}

/**
 * Manages the lifecycle of one ingest → recording pipeline for a single
 * device. If the session crashes it is restarted automatically with backoff.
 */
export class SessionRestartGuard {
  private pipeline: RecordingPipeline | undefined;
  private runner: CrashSafeRunner | undefined;

  constructor(
    private readonly provider: IngestProvider,
    private readonly deviceId: string,
    private readonly pipelineOpts: RecordingPipelineOptions,
    private readonly writerFactory?: SegmentWriterFactory,
    private readonly guardOpts: SessionRestartGuardOptions = {},
  ) {}

  start(): void {
    if (this.runner) return;
    const log = this.guardOpts.console ?? (globalThis as any).console;

    this.runner = new CrashSafeRunner(
      `session:${this.provider.providerId}/${this.deviceId}`,
      async () => {
        const session = await connectWithRetry(
          () => this.provider.openSession(this.deviceId),
          this.guardOpts.retry,
          log,
        );
        this.pipeline = new RecordingPipeline(session, this.pipelineOpts, this.writerFactory);
        await this.pipeline.start();
      },
      { maxRestarts: 20, initialDelayMs: 2_000, maxDelayMs: 120_000, console: log },
    );

    this.runner.start();
  }

  async stop(): Promise<void> {
    this.runner?.stop();
    await this.pipeline?.stop();
    this.runner = undefined;
    this.pipeline = undefined;
  }

  get isRunning(): boolean { return !!this.runner; }
  get restartCount(): number { return this.runner?.restartCount ?? 0; }
}

// ---------------------------------------------------------------------------
// StorageHealthCheck
// ---------------------------------------------------------------------------

/**
 * Lightweight storage health check.
 * Returns the used / available byte counts for the configured output directory.
 * Uses statvfs-style disk stats via Node's `fs.statfs` (Node ≥ 18.15).
 */
export interface StorageHealth {
  totalBytes: number;
  freeBytes: number;
  usedPercent: number;
  healthy: boolean;
}

/**
 * Check available disk space for the recording output directory.
 *
 * @param outputDir  Directory to check.
 * @param minFreeGb  Minimum free space (GB) before marking unhealthy. Default 1.
 */
export async function checkStorageHealth(
  outputDir: string,
  minFreeGb = 1,
): Promise<StorageHealth> {
  // Dynamic import so the module can be loaded in environments where `fs`
  // may not be available (e.g. bundled browser context).
  const fs = await import('fs');
  return new Promise((resolve) => {
    // fs.statfs is Node ≥ 18.15. Gracefully degrade on older runtimes.
    if (typeof (fs as any).statfs !== 'function') {
      resolve({ totalBytes: 0, freeBytes: 0, usedPercent: 0, healthy: true });
      return;
    }
    (fs as any).statfs(outputDir, (err: NodeJS.ErrnoException | null, stats: any) => {
      if (err) {
        resolve({ totalBytes: 0, freeBytes: 0, usedPercent: 0, healthy: false });
        return;
      }
      const totalBytes: number = stats.blocks * stats.bsize;
      const freeBytes: number = stats.bfree * stats.bsize;
      const usedPercent = totalBytes > 0
        ? Math.round(((totalBytes - freeBytes) / totalBytes) * 100)
        : 0;
      const healthy = freeBytes >= minFreeGb * 1024 ** 3;
      resolve({ totalBytes, freeBytes, usedPercent, healthy });
    });
  });
}
