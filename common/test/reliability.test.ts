/**
 * Unit tests for common/src/reliability.ts
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BoundedQueue, CrashSafeRunner } from '../src/reliability';

const silentConsole = {
  log: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Console;

// ---------------------------------------------------------------------------
// BoundedQueue
// ---------------------------------------------------------------------------

describe('BoundedQueue', () => {
  it('throws on maxSize <= 0', () => {
    assert.throws(() => new BoundedQueue(0), /maxSize must be > 0/);
  });

  it('stores items up to maxSize', () => {
    const q = new BoundedQueue<number>(3);
    q.push(1); q.push(2); q.push(3);
    assert.equal(q.size, 3);
  });

  it('drops oldest item when full', () => {
    const q = new BoundedQueue<number>(2);
    q.push(1); q.push(2); q.push(3);
    assert.equal(q.size, 2);
    assert.equal(q.shift(), 2); // 1 was dropped
    assert.equal(q.shift(), 3);
  });

  it('tracks droppedCount', () => {
    const q = new BoundedQueue<number>(2);
    q.push(1); q.push(2); q.push(3); q.push(4);
    assert.equal(q.droppedCount, 2);
  });

  it('shift returns undefined on empty queue', () => {
    const q = new BoundedQueue<number>(10);
    assert.equal(q.shift(), undefined);
    assert.equal(q.empty, true);
  });
});

// ---------------------------------------------------------------------------
// CrashSafeRunner
// ---------------------------------------------------------------------------

describe('CrashSafeRunner', () => {
  it('runs a task that completes normally', async () => {
    let ran = false;
    const runner = new CrashSafeRunner('test', async () => { ran = true; }, { console: silentConsole });
    runner.start();
    await new Promise(r => setTimeout(r, 20));
    assert.equal(ran, true);
  });

  it('restarts after a task throws', async () => {
    let attempts = 0;
    const runner = new CrashSafeRunner(
      'retry-test',
      async () => {
        attempts++;
        if (attempts < 3) throw new Error('crash');
      },
      { initialDelayMs: 5, maxDelayMs: 10, console: silentConsole },
    );
    runner.start();
    await new Promise(r => setTimeout(r, 200));
    assert.ok(attempts >= 3);
  });

  it('stops after maxRestarts', async () => {
    let attempts = 0;
    const runner = new CrashSafeRunner(
      'max-test',
      async () => { attempts++; throw new Error('always fail'); },
      { maxRestarts: 2, initialDelayMs: 5, maxDelayMs: 10, console: silentConsole },
    );
    runner.start();
    await new Promise(r => setTimeout(r, 300));
    // Should have tried at most maxRestarts + 1 times then given up.
    assert.ok(attempts <= 4, `expected attempts ≤ 4, got ${attempts}`);
  });

  it('stop() prevents further restarts', async () => {
    let attempts = 0;
    const runner = new CrashSafeRunner(
      'stop-test',
      async () => { attempts++; throw new Error('crash'); },
      { initialDelayMs: 5, maxDelayMs: 10, console: silentConsole },
    );
    runner.start();
    await new Promise(r => setTimeout(r, 15));
    runner.stop();
    const countAtStop = attempts;
    await new Promise(r => setTimeout(r, 100));
    // No more attempts after stop() was called.
    assert.ok(attempts - countAtStop <= 1);
  });
});
