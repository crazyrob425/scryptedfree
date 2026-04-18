/**
 * Unit tests for:
 *   - common/src/timeline.ts (TimelineEnricher, buildDoorbellEvent)
 *   - common/src/doorbell-cast.ts (DoorbellCastOrchestrator)
 */

import assert from 'node:assert/strict';
import { describe, it, beforeEach } from 'node:test';
import { buildDoorbellEvent, TimelineEnricher } from '../src/timeline';
import { buildEvent } from '../src/event-schema';
import { DoorbellCastOrchestrator, type CastTarget } from '../src/doorbell-cast';
import type { RecordingSegment } from '../src/recording';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSegment(startMs: number, endMs: number, id = `seg-${startMs}`): RecordingSegment {
  return { id, deviceLabel: 'test-cam', startMs, endMs, sizeBytes: 100, filePath: '/tmp/test.bin', open: false };
}

// A mock CastTarget that records calls.
class MockTarget implements CastTarget {
  readonly family = 'generic' as const;
  showCalls: Array<{ url: string; title: string; durationMs: number }> = [];
  dismissCalls = 0;
  failOnShow = false;

  constructor(
    public readonly id: string,
    public readonly label: string,
  ) {}

  async showPip(url: string, title: string, durationMs: number): Promise<void> {
    if (this.failOnShow) throw new Error('mock showPip failure');
    this.showCalls.push({ url, title, durationMs });
  }

  async dismissPip(): Promise<void> {
    this.dismissCalls++;
  }
}

// Silence logs in tests.
const silentConsole = {
  log: () => {},
  warn: () => {},
  error: () => {},
  info: () => {},
  debug: () => {},
} as unknown as Console;

// ---------------------------------------------------------------------------
// TimelineEnricher
// ---------------------------------------------------------------------------

describe('TimelineEnricher', () => {
  let enricher: TimelineEnricher;

  beforeEach(() => {
    enricher = new TimelineEnricher(5_000); // 5-second TTL in tests
  });

  it('ingests events and lists them', () => {
    const evt = buildEvent({
      provider: 'blink', deviceId: 'x', deviceLabel: 'X',
      type: 'motion_start', detections: [],
      timestampMs: 1_000,
    });
    enricher.ingest(evt);
    assert.equal(enricher.allEvents().length, 1);
  });

  it('deduplicates on event id', () => {
    const evt = buildEvent({ provider: 'p', deviceId: 'x', deviceLabel: 'X', type: 'motion_start', detections: [], id: 'dup' });
    enricher.ingest(evt);
    enricher.ingest(evt);
    assert.equal(enricher.allEvents().length, 1);
  });

  it('keeps events sorted by timestamp', () => {
    const e1 = buildEvent({ provider: 'p', deviceId: 'x', deviceLabel: 'X', type: 'motion_start', detections: [], timestampMs: 2_000 });
    const e2 = buildEvent({ provider: 'p', deviceId: 'x', deviceLabel: 'X', type: 'doorbell_press', detections: [], timestampMs: 1_000 });
    enricher.ingest(e1);
    enricher.ingest(e2);
    const all = enricher.allEvents();
    assert.equal(all[0].timestampMs, 1_000);
    assert.equal(all[1].timestampMs, 2_000);
  });

  it('returns overlapping events for a segment', () => {
    const t = 1_000_000;
    enricher.ingest(buildEvent({ provider: 'p', deviceId: 'x', deviceLabel: 'X', type: 'doorbell_press', detections: [], timestampMs: t + 5_000 }));
    enricher.ingest(buildEvent({ provider: 'p', deviceId: 'x', deviceLabel: 'X', type: 'motion_start', detections: [], timestampMs: t + 80_000 })); // outside window

    const seg = makeSegment(t, t + 60_000);
    const events = enricher.eventsForSegment(seg);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'doorbell_press');
  });

  it('enriches a segment with primary event and tags', () => {
    const t = 1_000_000;
    enricher.ingest(buildEvent({ provider: 'p', deviceId: 'x', deviceLabel: 'X', type: 'doorbell_press', detections: [{ detectionClass: 'doorbell', confidence: 1.0 }], timestampMs: t + 1_000 }));

    const enriched = enricher.enrich(makeSegment(t, t + 30_000));
    assert.equal(enriched.events.length, 1);
    assert.ok(enriched.primaryEvent);
    assert.equal(enriched.primaryEvent!.type, 'doorbell_press');
    assert.ok(enriched.tags.includes('doorbell'));
    assert.ok(enriched.tags.includes('doorbell_press'));
    assert.equal(enriched.confidence, 1.0);
  });

  it('disposes without throwing', () => {
    assert.doesNotThrow(() => enricher.dispose());
  });
});

// ---------------------------------------------------------------------------
// buildDoorbellEvent
// ---------------------------------------------------------------------------

describe('buildDoorbellEvent', () => {
  it('builds a valid doorbell event with expected fields', () => {
    const evt = buildDoorbellEvent({
      provider: 'blink',
      deviceId: 'cam-1',
      deviceLabel: 'Front Door',
      liveStreamUrl: 'rtsp://192.168.1.1/live',
      durationMs: 20_000,
    });
    assert.equal(evt.type, 'doorbell_press');
    assert.equal(evt.provider, 'blink');
    assert.equal(evt.deviceId, 'cam-1');
    assert.equal(evt.liveStreamUrl, 'rtsp://192.168.1.1/live');
    assert.equal(evt.durationMs, 20_000);
    assert.equal(evt.aggregateConfidence, 1.0);
    assert.ok(evt.id);
  });
});

// ---------------------------------------------------------------------------
// DoorbellCastOrchestrator
// ---------------------------------------------------------------------------

describe('DoorbellCastOrchestrator', () => {
  it('ignores non-doorbell events', async () => {
    const target = new MockTarget('t1', 'TV');
    const orc = new DoorbellCastOrchestrator({ targets: [target], console: silentConsole });
    const evt = buildEvent({ provider: 'p', deviceId: 'x', deviceLabel: 'X', type: 'motion_start', detections: [] });
    await orc.handle(evt);
    assert.equal(target.showCalls.length, 0);
  });

  it('ignores doorbell events with no liveStreamUrl', async () => {
    const target = new MockTarget('t1', 'TV');
    const orc = new DoorbellCastOrchestrator({ targets: [target], console: silentConsole });
    const evt = buildDoorbellEvent({ provider: 'blink', deviceId: 'x', deviceLabel: 'Front Door' });
    await orc.handle(evt);
    assert.equal(target.showCalls.length, 0);
  });

  it('calls showPip on all targets for a valid doorbell event', async () => {
    const t1 = new MockTarget('t1', 'Living Room TV');
    const t2 = new MockTarget('t2', 'Bedroom Display');
    const orc = new DoorbellCastOrchestrator({ targets: [t1, t2], console: silentConsole });

    const evt = buildDoorbellEvent({
      provider: 'blink', deviceId: 'cam-1', deviceLabel: 'Front Door',
      liveStreamUrl: 'rtsp://cam/live', durationMs: 5_000,
    });
    await orc.handle(evt);

    assert.equal(t1.showCalls.length, 1);
    assert.equal(t2.showCalls.length, 1);
    assert.equal(t1.showCalls[0].url, 'rtsp://cam/live');
    assert.equal(t1.showCalls[0].durationMs, 5_000);
  });

  it('deduplicates the same event ID', async () => {
    const t1 = new MockTarget('t1', 'TV');
    const orc = new DoorbellCastOrchestrator({ targets: [t1], console: silentConsole });
    const evt = buildDoorbellEvent({
      provider: 'blink', deviceId: 'x', deviceLabel: 'X',
      liveStreamUrl: 'rtsp://x/live', durationMs: 1_000,
    });
    await orc.handle(evt);
    await orc.handle(evt); // second call with same ID
    assert.equal(t1.showCalls.length, 1);
  });

  it('reports active casts', async () => {
    const t1 = new MockTarget('t1', 'TV');
    const orc = new DoorbellCastOrchestrator({ targets: [t1], defaultDurationMs: 60_000, console: silentConsole });
    const evt = buildDoorbellEvent({
      provider: 'blink', deviceId: 'x', deviceLabel: 'X',
      liveStreamUrl: 'rtsp://x/live', durationMs: 60_000,
    });
    await orc.handle(evt);
    assert.equal(orc.activeCasts().length, 1);
  });

  it('dismiss() calls dismissPip on all targets', async () => {
    const t1 = new MockTarget('t1', 'TV');
    const orc = new DoorbellCastOrchestrator({ targets: [t1], defaultDurationMs: 60_000, console: silentConsole });
    const evt = buildDoorbellEvent({
      provider: 'blink', deviceId: 'x', deviceLabel: 'X',
      liveStreamUrl: 'rtsp://x/live', durationMs: 60_000,
    });
    await orc.handle(evt);
    await orc.dismiss(evt.id);
    assert.equal(t1.dismissCalls, 1);
    assert.equal(orc.activeCasts().length, 0);
  });

  it('continues broadcasting to other targets when one fails', async () => {
    const failing = new MockTarget('fail', 'Bad TV');
    failing.failOnShow = true;
    const good = new MockTarget('good', 'Good TV');

    let failureHook = false;
    const orc = new DoorbellCastOrchestrator({
      targets: [failing, good],
      retry: { maxAttempts: 1 },
      console: silentConsole,
      onCastFailure: () => { failureHook = true; },
    });

    const evt = buildDoorbellEvent({
      provider: 'blink', deviceId: 'x', deviceLabel: 'X',
      liveStreamUrl: 'rtsp://x/live', durationMs: 5_000,
    });
    await orc.handle(evt);

    // Good target should have received the cast despite the bad one failing.
    assert.equal(good.showCalls.length, 1);
    assert.equal(failureHook, true);
  });
});
