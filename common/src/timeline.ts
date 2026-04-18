/**
 * Timeline enrichment: enriches recording segments with searchable event
 * metadata and confidence scores.
 *
 * The enricher sits between the event bus and the recording index. It stamps
 * segments with the highest-confidence detection in their time window so the
 * UI can surface "motion at 2:34 PM — person (95%)" without re-scanning video.
 */

import { buildEvent, computeAggregateConfidence, ScryptedEvent } from './event-schema';
import type { RecordingSegment } from './recording';

// ---------------------------------------------------------------------------
// Enriched segment
// ---------------------------------------------------------------------------

/**
 * A recording segment decorated with timeline metadata.
 * Consumers can store / index this shape directly.
 */
export interface EnrichedSegment {
  segment: RecordingSegment;
  /** All events that overlap with this segment, ordered by timestamp. */
  events: ScryptedEvent[];
  /** The single most-confident event in this segment (for quick display). */
  primaryEvent?: ScryptedEvent;
  /** Summary tags derived from `primaryEvent` (e.g. ["person","doorbell"]). */
  tags: string[];
  /** Aggregate confidence of the primary event, or undefined. */
  confidence?: number;
}

// ---------------------------------------------------------------------------
// TimelineEnricher
// ---------------------------------------------------------------------------

/**
 * Keeps an in-memory index of recent events keyed by time range and
 * annotates segments when asked.
 *
 * Design decisions:
 * - Events are stored in a ring-buffer with a configurable TTL.
 * - Segment annotation is O(n_events) per call — acceptable for typical NVR
 *   workloads where segment count and event burst size are both small.
 * - No external dependencies; fully testable without a running Scrypted server.
 */
export class TimelineEnricher {
  private readonly events: ScryptedEvent[] = [];
  private readonly ttlMs: number;
  private pruneTimer: ReturnType<typeof setInterval> | undefined;

  /**
   * @param ttlMs  How long to keep events in memory (default 24 h).
   *               Set lower in tests to keep memory usage minimal.
   */
  constructor(ttlMs = 24 * 60 * 60_000) {
    this.ttlMs = ttlMs;
    // Prune stale events every 5 minutes so memory stays bounded.
    this.pruneTimer = setInterval(() => this.prune(), 5 * 60_000);
    // Allow the Node process to exit even if this interval is still running.
    if (this.pruneTimer.unref) this.pruneTimer.unref();
  }

  /**
   * Ingest an event from any provider. Idempotent on `event.id`.
   */
  ingest(event: ScryptedEvent): void {
    if (this.events.some(e => e.id === event.id)) return;
    this.events.push(event);
    // Keep ordered by timestamp for efficient range queries.
    this.events.sort((a, b) => a.timestampMs - b.timestampMs);
  }

  /**
   * Return all ingested events that overlap with the segment's time window.
   * An event "overlaps" if its timestamp falls within [startMs, endMs + durationMs].
   */
  eventsForSegment(segment: RecordingSegment): ScryptedEvent[] {
    const start = segment.startMs;
    const end = (segment.endMs ?? Date.now()) + 5_000; // 5-second grace period

    return this.events.filter(e => {
      const evEnd = e.timestampMs + (e.durationMs ?? 0);
      return evEnd >= start && e.timestampMs <= end;
    });
  }

  /**
   * Annotate a segment with its matching events, primary event, tags, and
   * aggregate confidence.
   */
  enrich(segment: RecordingSegment): EnrichedSegment {
    const events = this.eventsForSegment(segment);

    // Pick the most confident event; fall back to the latest if no scores.
    const withScore = events.filter(e => e.aggregateConfidence !== undefined);
    const primaryEvent =
      withScore.length > 0
        ? withScore.reduce((best, e) =>
            (e.aggregateConfidence ?? 0) > (best.aggregateConfidence ?? 0) ? e : best,
          )
        : events.at(-1);

    const tags = deriveTags(events);
    const confidence = primaryEvent?.aggregateConfidence;

    return { segment, events, primaryEvent, tags, confidence };
  }

  /**
   * Enrich a list of segments in bulk (e.g. for a UI page load).
   */
  enrichAll(segments: RecordingSegment[]): EnrichedSegment[] {
    return segments.map(s => this.enrich(s));
  }

  /** Remove events older than `ttlMs`. */
  private prune(): void {
    const cutoff = Date.now() - this.ttlMs;
    let i = 0;
    while (i < this.events.length && this.events[i].timestampMs < cutoff) {
      i++;
    }
    if (i > 0) this.events.splice(0, i);
  }

  /** Stop the background prune timer. */
  dispose(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = undefined;
    }
  }

  /** Snapshot of all currently-held events (for testing / debugging). */
  allEvents(): ReadonlyArray<ScryptedEvent> {
    return this.events;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deriveTags(events: ScryptedEvent[]): string[] {
  const tagSet = new Set<string>();
  for (const ev of events) {
    tagSet.add(ev.type);
    for (const d of ev.detections) {
      tagSet.add(d.detectionClass);
    }
  }
  return [...tagSet];
}

// ---------------------------------------------------------------------------
// Convenience: build a doorbell-press event from a Blink/Ring callback
// ---------------------------------------------------------------------------

/**
 * Build a normalised doorbell-press event from provider data.
 * Designed to be called directly from `BlinkCameraDevice` or `RingCameraDevice`.
 */
export function buildDoorbellEvent(opts: {
  provider: string;
  deviceId: string;
  deviceLabel: string;
  liveStreamUrl?: string;
  thumbnailBase64?: string;
  durationMs?: number;
}): ScryptedEvent {
  return buildEvent({
    provider: opts.provider,
    deviceId: opts.deviceId,
    deviceLabel: opts.deviceLabel,
    type: 'doorbell_press',
    detections: [{ detectionClass: 'doorbell', confidence: 1.0 }],
    liveStreamUrl: opts.liveStreamUrl,
    thumbnailBase64: opts.thumbnailBase64,
    durationMs: opts.durationMs ?? 30_000,
  });
}
