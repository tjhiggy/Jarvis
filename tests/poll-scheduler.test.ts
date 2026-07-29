import { describe, expect, it } from 'vitest';
import {
  PollScheduler,
  type PollSchedulerTimers,
} from '../src/polls/poll-scheduler.js';
import type { PollView } from '../src/polls/poll-types.js';

const poll = (id: string): PollView => ({
  id,
  guildId: 'guild-1',
  conversationId: 'channel-1',
  channelId: 'channel-1',
  creatorUserId: 'admin-1',
  question: 'Untrusted question that must not be logged',
  status: 'closed',
  closesAt: new Date('2026-07-29T12:00:00.000Z'),
  syncState: 'pending',
  syncAttempts: 0,
  options: [
    { index: 0, label: 'One', voteCount: 1 },
    { index: 1, label: 'Two', voteCount: 0 },
  ],
});

describe('PollScheduler', () => {
  it('closes due polls, synchronizes pending polls, and cleans retained records in bounded batches', async () => {
    const calls: string[] = [];
    const scheduler = new PollScheduler({
      service: {
        closeExpired: async (now) => {
          calls.push(`close:${now.toISOString()}`);
          return [poll('due-1'), poll('due-2')];
        },
        cleanup: async (cutoff) => {
          calls.push(`cleanup:${cutoff.toISOString()}`);
          return 2;
        },
      },
      store: {
        listPendingSync: async (now, limit) => {
          calls.push(`pending:${now.toISOString()}:${limit}`);
          return [poll('retry-1')];
        },
      },
      controller: {
        synchronize: async (value) => {
          calls.push(`sync:${value.id}`);
        },
      },
      now: () => new Date('2026-07-29T12:00:00.000Z'),
      retentionDays: 30,
      batchSize: 2,
    });

    await scheduler.runNow();

    expect(calls).toEqual([
      'close:2026-07-29T12:00:00.000Z',
      'sync:due-1',
      'sync:due-2',
      'pending:2026-07-29T12:00:00.000Z:2',
      'sync:retry-1',
      'cleanup:2026-06-29T12:00:00.000Z',
    ]);
    expect(scheduler.healthy).toBe(true);
  });

  it('allows only one active tick and waits for it during shutdown', async () => {
    const timers = createTimers();
    let releaseClose = (): void => undefined;
    const closeStarted = deferred<void>();
    const closeFinished = deferred<void>();
    const scheduler = new PollScheduler({
      service: {
        closeExpired: async () => {
          closeStarted.resolve();
          await new Promise<void>((resolve) => {
            releaseClose = resolve;
          });
          closeFinished.resolve();
          return [];
        },
        cleanup: async () => 0,
      },
      store: { listPendingSync: async () => [] },
      controller: { synchronize: async () => undefined },
      timers,
      intervalMs: 30_000,
    });

    scheduler.start();
    await closeStarted.promise;
    const sameTick = scheduler.runNow();
    const stopping = scheduler.stop();
    expect(timers.cleared).toEqual(['timer-1']);

    releaseClose();
    await closeFinished.promise;
    await Promise.all([sameTick, stopping]);
    expect(timers.callbacks).toHaveLength(1);
  });

  it('contains stage errors, reports unhealthy, and recovers after a clean tick without logging poll text', async () => {
    const logs: Record<string, unknown>[] = [];
    let shouldFail = true;
    const scheduler = new PollScheduler({
      service: {
        closeExpired: async () => {
          if (shouldFail) {
            throw new Error('untrusted question that must not be logged');
          }
          return [];
        },
        cleanup: async () => 0,
      },
      store: { listPendingSync: async () => [] },
      controller: { synchronize: async () => undefined },
      logger: {
        info: (context) => logs.push(context),
        warn: (context) => logs.push(context),
      },
    });

    await expect(scheduler.runNow()).resolves.toBeUndefined();
    expect(scheduler.healthy).toBe(false);
    expect(JSON.stringify(logs)).not.toContain('untrusted question');

    shouldFail = false;
    await scheduler.runNow();
    expect(scheduler.healthy).toBe(true);
  });
});

function createTimers(): PollSchedulerTimers & {
  readonly callbacks: Array<() => void>;
  readonly cleared: unknown[];
} {
  const callbacks: Array<() => void> = [];
  const cleared: unknown[] = [];
  return {
    callbacks,
    cleared,
    setInterval: (callback) => {
      callbacks.push(callback);
      return `timer-${callbacks.length}`;
    },
    clearInterval: (handle) => {
      cleared.push(handle);
    },
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve: ((value: T | PromiseLike<T>) => void) | undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  if (resolve === undefined) {
    throw new Error('Deferred promise initialization failed.');
  }
  return { promise, resolve };
}
