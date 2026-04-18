/**
 * PiP Doorbell Cast Orchestrator
 *
 * When a doorbell-press event arrives (from Blink, Ring, SIP, or any provider
 * that emits a normalised `ScryptedEvent` with `type === 'doorbell_press'`),
 * this module:
 *
 *   1. Fetches the live-stream URL from the originating camera.
 *   2. Broadcasts the stream to every registered display target
 *      (Chromecast, Fire TV, Vizio, etc.) in parallel.
 *   3. Requests a Picture-in-Picture (PiP) overlay so existing content keeps
 *      playing while the doorbell feed appears in the corner.
 *   4. Auto-dismisses the overlay after `event.durationMs` milliseconds.
 *   5. Retries failed cast targets with exponential backoff without blocking
 *      the other targets.
 *
 * No Scrypted SDK runtime is needed — the orchestrator depends only on the
 * abstract `CastTarget` interface, making it fully unit-testable.
 */

import { ScryptedEvent, isDoorbellEvent } from './event-schema';
import { connectWithRetry, RetryOptions } from './ingest';

// ---------------------------------------------------------------------------
// Cast target interface
// ---------------------------------------------------------------------------

/**
 * Describes any display device that can receive a video cast.
 * Concrete implementations live in the `pip-doorbell-cast` plugin:
 *   - `ChromecastPipTarget`  — uses castv2-client
 *   - `FireTvPipTarget`      — uses ADB commands
 *   - `AlexaShowPipTarget`   — uses the Alexa Smart Home API
 */
export interface CastTarget {
  /** Stable human-readable identifier, e.g. "Living Room TV". */
  readonly id: string;
  /** Display name for logs / UI. */
  readonly label: string;
  /** Device family for routing decisions. */
  readonly family: 'chromecast' | 'firetv' | 'alexa-show' | 'vizio' | 'generic';

  /**
   * Request this device to show the `liveStreamUrl` in a PiP overlay.
   *
   * @param liveStreamUrl  HTTP/HTTPS or RTSP URL of the camera stream.
   * @param title          One-line title shown in the PiP chrome (e.g. "Front Door").
   * @param durationMs     How long the overlay should stay visible.
   */
  showPip(
    liveStreamUrl: string,
    title: string,
    durationMs: number,
  ): Promise<void>;

  /**
   * Dismiss the PiP overlay before `durationMs` expires, if possible.
   * Idempotent.
   */
  dismissPip(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Orchestrator options
// ---------------------------------------------------------------------------

export interface DoorbellCastOptions {
  /**
   * Display targets to cast to.
   * Register them once at startup; the orchestrator broadcasts to all.
   */
  targets: CastTarget[];

  /**
   * Retry policy applied to each individual cast target.
   * Failures on one target do not block others.
   */
  retry?: RetryOptions;

  /**
   * Default PiP duration in ms when the event doesn't specify one.
   * Defaults to 30 s.
   */
  defaultDurationMs?: number;

  /** For log output. Defaults to `console`. */
  console?: Console;

  /**
   * Optional hook called when a target successfully shows PiP.
   * Useful for telemetry or integration tests.
   */
  onCastSuccess?: (targetId: string, event: ScryptedEvent) => void;

  /**
   * Optional hook called when a target fails all retry attempts.
   */
  onCastFailure?: (targetId: string, event: ScryptedEvent, err: unknown) => void;
}

// ---------------------------------------------------------------------------
// Active cast session
// ---------------------------------------------------------------------------

interface ActiveSession {
  event: ScryptedEvent;
  dismissTimers: Map<string, ReturnType<typeof setTimeout>>;
}

// ---------------------------------------------------------------------------
// DoorbellCastOrchestrator
// ---------------------------------------------------------------------------

/**
 * Singleton-friendly orchestrator.  Typical usage:
 *
 * ```ts
 * const orchestrator = new DoorbellCastOrchestrator({
 *   targets: [livingRoomTv, bedroomDisplay],
 *   defaultDurationMs: 30_000,
 * });
 *
 * // Wire to your event bus:
 * eventBus.on('doorbell', event => orchestrator.handle(event));
 * ```
 */
export class DoorbellCastOrchestrator {
  private readonly opts: Required<
    Omit<DoorbellCastOptions, 'onCastSuccess' | 'onCastFailure'>
  > &
    Pick<DoorbellCastOptions, 'onCastSuccess' | 'onCastFailure'>;

  /** Tracks in-flight PiP sessions by event ID. */
  private readonly activeSessions = new Map<string, ActiveSession>();

  constructor(opts: DoorbellCastOptions) {
    this.opts = {
      targets: opts.targets,
      retry: opts.retry ?? { maxAttempts: 3, initialDelayMs: 500, maxDelayMs: 5_000 },
      defaultDurationMs: opts.defaultDurationMs ?? 30_000,
      console: opts.console ?? (globalThis as any).console,
      onCastSuccess: opts.onCastSuccess,
      onCastFailure: opts.onCastFailure,
    };
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Handle any `ScryptedEvent`.  Non-doorbell events are silently ignored so
   * callers can pipe the full event stream without pre-filtering.
   */
  async handle(event: ScryptedEvent): Promise<void> {
    if (!isDoorbellEvent(event)) return;
    if (this.activeSessions.has(event.id)) return; // deduplicate

    const liveStreamUrl = event.liveStreamUrl;
    if (!liveStreamUrl) {
      this.opts.console.warn(
        `[pip-cast] doorbell event ${event.id} has no liveStreamUrl — skipping cast`,
      );
      return;
    }

    const durationMs = event.durationMs ?? this.opts.defaultDurationMs;
    const title = `🔔 ${event.deviceLabel}`;

    const session: ActiveSession = {
      event,
      dismissTimers: new Map(),
    };
    this.activeSessions.set(event.id, session);

    this.opts.console.log(
      `[pip-cast] doorbell ${event.id} from "${event.deviceLabel}" — casting to ${this.opts.targets.length} target(s)`,
    );

    // Fan out to all targets in parallel; each target retries independently.
    await Promise.allSettled(
      this.opts.targets.map(target =>
        this.castToTarget(target, event, liveStreamUrl, title, durationMs, session),
      ),
    );
  }

  /**
   * Explicitly dismiss all active PiP sessions for a given event ID.
   * Called when the user answers the door or the event stream closes.
   */
  async dismiss(eventId: string): Promise<void> {
    const session = this.activeSessions.get(eventId);
    if (!session) return;

    this.activeSessions.delete(eventId);

    await Promise.allSettled(
      this.opts.targets.map(async target => {
        const timer = session.dismissTimers.get(target.id);
        if (timer) clearTimeout(timer);
        session.dismissTimers.delete(target.id);
        try {
          await target.dismissPip();
        } catch (e) {
          this.opts.console.warn(`[pip-cast] dismissPip failed for "${target.id}":`, e);
        }
      }),
    );
  }

  /** List all currently active doorbell sessions. */
  activeCasts(): ScryptedEvent[] {
    return [...this.activeSessions.values()].map(s => s.event);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private async castToTarget(
    target: CastTarget,
    event: ScryptedEvent,
    liveStreamUrl: string,
    title: string,
    durationMs: number,
    session: ActiveSession,
  ): Promise<void> {
    try {
      await connectWithRetry(
        async () => target.showPip(liveStreamUrl, title, durationMs),
        this.opts.retry,
        this.opts.console,
      );

      this.opts.console.log(
        `[pip-cast] ✓ cast to "${target.id}" succeeded (${durationMs}ms PiP)`,
      );
      this.opts.onCastSuccess?.(target.id, event);

      // Schedule automatic dismissal.
      const timer = setTimeout(async () => {
        session.dismissTimers.delete(target.id);
        this.activeSessions.delete(event.id);
        try {
          await target.dismissPip();
        } catch (_) {
          // Best-effort dismiss.
        }
      }, durationMs + 1_000); // +1 s grace

      if ((timer as any).unref) (timer as any).unref();
      session.dismissTimers.set(target.id, timer);
    } catch (err) {
      this.opts.console.error(
        `[pip-cast] ✗ cast to "${target.id}" failed after all retries:`,
        err,
      );
      this.opts.onCastFailure?.(target.id, event, err);
    }
  }
}
