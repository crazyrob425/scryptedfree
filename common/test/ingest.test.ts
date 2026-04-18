/**
 * Unit tests for the ingest.ts provider-agnostic contract.
 *
 * No Scrypted SDK runtime is required; tests exercise only the shared module.
 */

import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { connectWithRetry, type IngestFrame, type IngestProvider, type IngestSession } from '../src/ingest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal in-memory IngestSession from a fixed list of frames. */
function makeSession(
  label: string,
  frames: IngestFrame[],
  failAfter = Infinity,
): IngestSession {
  let stopped = false;

  return {
    label,
    async stop() {
      stopped = true;
    },
    async *frames(): AsyncGenerator<IngestFrame> {
      let idx = 0;
      for (const frame of frames) {
        if (stopped) return;
        if (idx >= failAfter) throw new Error('simulated stream failure');
        yield frame;
        idx++;
      }
    },
  };
}

function makeFrame(seq: number): IngestFrame {
  return {
    data: Buffer.from(`frame-${seq}`),
    meta: {
      timestampMs: 1_000_000 + seq * 100,
      codec: 'h264',
      keyframe: seq % 5 === 0,
      sequence: seq,
    },
  };
}

// ---------------------------------------------------------------------------
// IngestSession
// ---------------------------------------------------------------------------

describe('IngestSession', () => {
  it('yields all frames in order', async () => {
    const expected = [makeFrame(0), makeFrame(1), makeFrame(2)];
    const session = makeSession('cam-0', expected);

    const received: IngestFrame[] = [];
    for await (const frame of session.frames()) {
      received.push(frame);
    }

    assert.equal(received.length, expected.length);
    for (let i = 0; i < expected.length; i++) {
      assert.equal(received[i].meta.sequence, i);
    }
  });

  it('stops emitting frames after stop() is called', async () => {
    const session = makeSession('cam-1', [makeFrame(0), makeFrame(1), makeFrame(2)]);

    const received: IngestFrame[] = [];
    for await (const frame of session.frames()) {
      received.push(frame);
      if (received.length === 1) {
        await session.stop();
      }
    }

    assert.equal(received.length, 1);
  });

  it('throws when stream simulates an error', async () => {
    const session = makeSession('cam-err', [makeFrame(0), makeFrame(1)], 1);

    await assert.rejects(async () => {
      for await (const _ of session.frames()) { /* consume */ }
    }, /simulated stream failure/);
  });
});

// ---------------------------------------------------------------------------
// IngestProvider
// ---------------------------------------------------------------------------

describe('IngestProvider', () => {
  it('satisfies the interface contract', async () => {
    const frames = [makeFrame(0), makeFrame(1)];
    const provider: IngestProvider = {
      providerId: 'test-provider',
      async openSession(deviceId, opts) {
        return makeSession(`${deviceId}-session`, frames);
      },
      async listDeviceIds() {
        return ['device-a', 'device-b'];
      },
    };

    const ids = await provider.listDeviceIds();
    assert.deepEqual(ids, ['device-a', 'device-b']);

    const session = await provider.openSession('device-a', { preferredCodecs: ['h264'] });
    assert.equal(session.label, 'device-a-session');

    const collected: IngestFrame[] = [];
    for await (const frame of session.frames()) {
      collected.push(frame);
    }
    assert.equal(collected.length, 2);
  });
});

// ---------------------------------------------------------------------------
// connectWithRetry
// ---------------------------------------------------------------------------

describe('connectWithRetry', () => {
  it('returns the result on the first successful attempt', async () => {
    const result = await connectWithRetry(async () => 42);
    assert.equal(result, 42);
  });

  it('retries until success', async () => {
    let attempts = 0;
    const result = await connectWithRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error('transient');
        return 'ok';
      },
      { maxAttempts: 5, initialDelayMs: 1 },
    );
    assert.equal(result, 'ok');
    assert.equal(attempts, 3);
  });

  it('throws after exhausting all attempts', async () => {
    await assert.rejects(
      () =>
        connectWithRetry(async () => { throw new Error('permanent'); }, {
          maxAttempts: 3,
          initialDelayMs: 1,
        }),
      /permanent/,
    );
  });

  it('respects maxAttempts', async () => {
    let count = 0;
    await assert.rejects(async () => {
      await connectWithRetry(
        async () => {
          count++;
          throw new Error('always fails');
        },
        { maxAttempts: 4, initialDelayMs: 1 },
      );
    });
    assert.equal(count, 4);
  });

  it('logs warnings for each failed attempt', async () => {
    const warnings: string[] = [];
    const fakeConsole = {
      warn: (...args: unknown[]) => warnings.push(String(args[0])),
    } as unknown as Console;

    let attempts = 0;
    await connectWithRetry(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error('oops');
        return true;
      },
      { maxAttempts: 5, initialDelayMs: 1 },
      fakeConsole,
    );

    assert.equal(warnings.length, 2);
    assert.match(warnings[0], /\[ingest\] attempt 1\/5/);
  });
});
