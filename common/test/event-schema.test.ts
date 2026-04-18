/**
 * Unit tests for common/src/event-schema.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildEvent,
  computeAggregateConfidence,
  createEventId,
  isDoorbellEvent,
  isHighConfidence,
  isMotionEvent,
  type DetectionResult,
  type ScryptedEvent,
} from '../src/event-schema';

// ---------------------------------------------------------------------------
// createEventId
// ---------------------------------------------------------------------------

describe('createEventId', () => {
  it('generates unique IDs', () => {
    const a = createEventId();
    const b = createEventId();
    assert.notEqual(a, b);
  });

  it('includes the supplied timestamp', () => {
    const id = createEventId(12345);
    assert.match(id, /^12345-/);
  });
});

// ---------------------------------------------------------------------------
// computeAggregateConfidence
// ---------------------------------------------------------------------------

describe('computeAggregateConfidence', () => {
  it('returns undefined for empty detections', () => {
    assert.equal(computeAggregateConfidence([]), undefined);
  });

  it('returns undefined when no detection has a confidence', () => {
    const d: DetectionResult[] = [
      { detectionClass: 'motion' },
      { detectionClass: 'person' },
    ];
    assert.equal(computeAggregateConfidence(d), undefined);
  });

  it('averages confidence scores correctly', () => {
    const d: DetectionResult[] = [
      { detectionClass: 'person', confidence: 0.8 },
      { detectionClass: 'motion', confidence: 0.6 },
    ];
    const result = computeAggregateConfidence(d);
    assert.ok(result !== undefined);
    assert.ok(Math.abs(result - 0.7) < 0.0001);
  });

  it('ignores detections without confidence when computing average', () => {
    const d: DetectionResult[] = [
      { detectionClass: 'motion' },
      { detectionClass: 'person', confidence: 1.0 },
    ];
    assert.equal(computeAggregateConfidence(d), 1.0);
  });
});

// ---------------------------------------------------------------------------
// buildEvent
// ---------------------------------------------------------------------------

describe('buildEvent', () => {
  it('auto-fills id, timestampMs, and aggregateConfidence', () => {
    const evt = buildEvent({
      provider: 'test',
      deviceId: 'cam-1',
      deviceLabel: 'Front Door',
      type: 'doorbell_press',
      detections: [{ detectionClass: 'doorbell', confidence: 1.0 }],
    });

    assert.ok(evt.id, 'id should be set');
    assert.ok(evt.timestampMs > 0, 'timestampMs should be set');
    assert.equal(evt.aggregateConfidence, 1.0);
  });

  it('preserves caller-supplied id and timestampMs', () => {
    const evt = buildEvent({
      id: 'my-id',
      timestampMs: 999,
      provider: 'test',
      deviceId: 'cam-1',
      deviceLabel: 'X',
      type: 'motion_start',
      detections: [],
    });
    assert.equal(evt.id, 'my-id');
    assert.equal(evt.timestampMs, 999);
  });

  it('sets aggregateConfidence to undefined when no scores', () => {
    const evt = buildEvent({
      provider: 'test',
      deviceId: 'x',
      deviceLabel: 'X',
      type: 'motion_start',
      detections: [{ detectionClass: 'motion' }],
    });
    assert.equal(evt.aggregateConfidence, undefined);
  });
});

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

describe('isDoorbellEvent', () => {
  it('true for type = doorbell_press', () => {
    const evt = buildEvent({
      provider: 'blink', deviceId: 'x', deviceLabel: 'X',
      type: 'doorbell_press', detections: [],
    });
    assert.equal(isDoorbellEvent(evt), true);
  });

  it('true when detections contain doorbell class', () => {
    const evt = buildEvent({
      provider: 'blink', deviceId: 'x', deviceLabel: 'X',
      type: 'detection',
      detections: [{ detectionClass: 'doorbell' }],
    });
    assert.equal(isDoorbellEvent(evt), true);
  });

  it('false for motion events without doorbell detection', () => {
    const evt = buildEvent({
      provider: 'blink', deviceId: 'x', deviceLabel: 'X',
      type: 'motion_start',
      detections: [{ detectionClass: 'motion' }],
    });
    assert.equal(isDoorbellEvent(evt), false);
  });
});

describe('isMotionEvent', () => {
  it('true for motion_start', () => {
    const evt = buildEvent({
      provider: 'p', deviceId: 'x', deviceLabel: 'X',
      type: 'motion_start', detections: [],
    });
    assert.equal(isMotionEvent(evt), true);
  });

  it('false for doorbell_press with no motion detection', () => {
    const evt = buildEvent({
      provider: 'p', deviceId: 'x', deviceLabel: 'X',
      type: 'doorbell_press',
      detections: [{ detectionClass: 'doorbell' }],
    });
    assert.equal(isMotionEvent(evt), false);
  });
});

describe('isHighConfidence', () => {
  it('true when aggregateConfidence >= threshold', () => {
    const evt = buildEvent({
      provider: 'p', deviceId: 'x', deviceLabel: 'X',
      type: 'detection',
      detections: [{ detectionClass: 'person', confidence: 0.9 }],
    });
    assert.equal(isHighConfidence(evt, 0.8), true);
  });

  it('false when aggregateConfidence < threshold', () => {
    const evt = buildEvent({
      provider: 'p', deviceId: 'x', deviceLabel: 'X',
      type: 'detection',
      detections: [{ detectionClass: 'person', confidence: 0.4 }],
    });
    assert.equal(isHighConfidence(evt, 0.6), false);
  });

  it('false when aggregateConfidence is undefined', () => {
    const evt = buildEvent({
      provider: 'p', deviceId: 'x', deviceLabel: 'X',
      type: 'motion_start', detections: [],
    });
    assert.equal(isHighConfidence(evt), false);
  });
});
