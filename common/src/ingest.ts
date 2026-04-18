/**
 * Provider-agnostic ingest interfaces for the shared recording pipeline.
 *
 * Any camera or sensor provider should implement these contracts so that
 * the recording core can consume streams without knowing provider specifics.
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** Serialisable metadata attached to each ingest frame. */
export interface IngestFrameMeta {
  /** Wall-clock timestamp when the frame was produced (ms since epoch). */
  timestampMs: number;
  /** Rough codec identifier, e.g. "h264", "h265", "aac". */
  codec?: string;
  /** Whether this frame is a key-frame / IDR. */
  keyframe?: boolean;
  /** Provider-assigned sequence number, if available. */
  sequence?: number;
}

/** A single chunk / frame of ingest data coming from a provider session. */
export interface IngestFrame {
  /** Raw encoded data. */
  data: Buffer;
  meta: IngestFrameMeta;
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/** Controls an active ingest connection for one camera/sensor. */
export interface IngestSession {
  /**
   * Async generator that yields frames in arrival order.
   * The generator should complete (return) when the session ends normally
   * and throw when the session ends with an error.
   */
  frames(): AsyncGenerator<IngestFrame>;

  /**
   * Stop the session gracefully. Idempotent.
   */
  stop(): Promise<void>;

  /**
   * Human-readable label for logging / metrics.
   */
  readonly label: string;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/** Options for establishing an ingest connection. */
export interface IngestConnectionOptions {
  /**
   * Preferred codec(s) the pipeline accepts.
   * Providers should down-select if they support multiple.
   */
  preferredCodecs?: string[];
  /**
   * Request audio alongside video when available.
   * Defaults to false to minimize bandwidth.
   */
  includeAudio?: boolean;
  /** Provider-specific opaque extra parameters. */
  extra?: Record<string, unknown>;
}

/**
 * A camera / sensor integration must implement this interface so the
 * recording pipeline can open, use, and close ingest sessions without
 * coupling to provider-specific APIs.
 */
export interface IngestProvider {
  /**
   * Unique provider identifier, e.g. "ring", "blink", "onvif".
   */
  readonly providerId: string;

  /**
   * Open an ingest session for one device.
   *
   * @param deviceId - Provider-scoped device identifier.
   * @param options  - Connection preferences.
   */
  openSession(
    deviceId: string,
    options?: IngestConnectionOptions,
  ): Promise<IngestSession>;

  /**
   * List device IDs this provider currently knows about.
   * Used by the pipeline to enumerate devices at startup or after discovery.
   */
  listDeviceIds(): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Retry / backoff
// ---------------------------------------------------------------------------

/** Configuration for the shared retry helper. */
export interface RetryOptions {
  /** Maximum number of retry attempts. Defaults to 5. */
  maxAttempts?: number;
  /** Initial backoff delay in ms. Doubles each attempt up to `maxDelayMs`. */
  initialDelayMs?: number;
  /** Upper bound for backoff delay in ms. Defaults to 30 000. */
  maxDelayMs?: number;
  /** Optional jitter fraction in [0, 1]. Adds randomness to reduce thundering herd. */
  jitter?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Run `action` with exponential-backoff retries.
 *
 * Each attempt is logged to `console`. Throws the last error if all attempts
 * are exhausted.
 */
export async function connectWithRetry<T>(
  action: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
  console?: Console,
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const initialDelayMs = opts.initialDelayMs ?? 1_000;
  const maxDelayMs = opts.maxDelayMs ?? 30_000;
  const jitter = Math.min(1, Math.max(0, opts.jitter ?? 0.2));

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await action(attempt);
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts - 1) {
        break;
      }
      const base = Math.min(initialDelayMs * 2 ** attempt, maxDelayMs);
      const delay = base * (1 + jitter * Math.random());
      console?.warn(
        `[ingest] attempt ${attempt + 1}/${maxAttempts} failed; retrying in ${Math.round(delay)}ms`,
        err,
      );
      await sleep(delay);
    }
  }

  throw lastError;
}
