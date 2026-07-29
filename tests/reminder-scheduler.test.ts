import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import type {
  ReminderDeliveryGateway,
  ReminderDeliveryOutcome,
} from '../src/reminders/reminder-delivery-gateway.js';
import {
  ReminderScheduler,
  type ReminderSchedulerDependencies,
  type ReminderSchedulerTimers,
} from '../src/reminders/reminder-scheduler.js';
import { SQLiteReminderStore } from '../src/reminders/sqlite-reminder-store.js';
import type { ReminderStore } from '../src/reminders/reminder-store.js';
import type { ReminderView } from '../src/reminders/reminder-types.js';

describe('ReminderScheduler lifecycle', () => {
  it('starts one interval and runs one immediate tick', async () => {
    const timers = createTimers();
    let recoveryCount = 0;
    const scheduler = schedulerFor({
      timers,
      store: createStore({
        recoverExpiredClaims: async () => {
          recoveryCount += 1;
          return 0;
        },
      }),
    });

    scheduler.start();
    scheduler.start();
    await scheduler.runNow();

    expect(timers.callbacks).toHaveLength(1);
    expect(timers.delays).toEqual([30_000]);
    expect(recoveryCount).toBe(1);
  });

  it('shares one active tick across overlapping run requests', async () => {
    const recoveryStarted = deferred<void>();
    const releaseRecovery = deferred<void>();
    const scheduler = schedulerFor({
      store: createStore({
        recoverExpiredClaims: async () => {
          recoveryStarted.resolve();
          await releaseRecovery.promise;
          return 0;
        },
      }),
    });

    const first = scheduler.runNow();
    await recoveryStarted.promise;
    const overlapping = scheduler.runNow();

    expect(overlapping).toBe(first);
    releaseRecovery.resolve();
    await first;
  });

  it('clears its interval and waits for an active tick during stop', async () => {
    const timers = createTimers();
    const recoveryStarted = deferred<void>();
    const releaseRecovery = deferred<void>();
    let tickFinished = false;
    const scheduler = schedulerFor({
      timers,
      store: createStore({
        recoverExpiredClaims: async () => {
          recoveryStarted.resolve();
          await releaseRecovery.promise;
          tickFinished = true;
          return 0;
        },
      }),
    });

    scheduler.start();
    await recoveryStarted.promise;
    let stopFinished = false;
    const stopping = scheduler.stop().then(() => {
      stopFinished = true;
    });

    expect(timers.cleared).toEqual(['timer-1']);
    await Promise.resolve();
    expect(stopFinished).toBe(false);

    releaseRecovery.resolve();
    await stopping;
    expect(tickFinished).toBe(true);
  });

  it('rejects new work after it has stopped', async () => {
    const scheduler = schedulerFor();

    await scheduler.stop();

    await expect(scheduler.runNow()).rejects.toThrow(
      'Reminder scheduler is stopped.',
    );
  });

  it.each([
    ['intervalMs', { intervalMs: 0 }],
    ['batchSize', { batchSize: 0 }],
    ['cleanupBatchSize', { cleanupBatchSize: 0 }],
    ['leaseTimeoutMs', { leaseTimeoutMs: 0 }],
    ['retentionDays', { retentionDays: 0 }],
    ['retry delay', { retryDelaysMs: [60_000, 0, 900_000] }],
    [
      'short retry delay tuple',
      {
        retryDelaysMs: [60_000, 300_000] as unknown as readonly [
          number,
          number,
          number,
        ],
      },
    ],
    [
      'long retry delay tuple',
      {
        retryDelaysMs: [
          60_000, 300_000, 900_000, 1_800_000,
        ] as unknown as readonly [number, number, number],
      },
    ],
  ] as const)('rejects invalid %s configuration', (_name, overrides) => {
    expect(() =>
      schedulerFor(overrides as Partial<ReminderSchedulerDependencies>),
    ).toThrow(RangeError);
  });
});

describe('ReminderScheduler delivery tick', () => {
  it('recovers, claims one bounded batch, persists each outcome sequentially, and performs bounded cleanup', async () => {
    const calls: string[] = [];
    const store = createStore({
      recoverExpiredClaims: async (cutoff, now) => {
        calls.push(`recover:${cutoff.toISOString()}:${now.toISOString()}`);
        return 2;
      },
      claimDue: async (now, leaseId, limit) => {
        calls.push(`claim:${now.toISOString()}:${leaseId}:${limit}`);
        return [reminder('delivered'), reminder('permanent')];
      },
      markDelivered: async (id, leaseId, at) => {
        calls.push(`delivered:${id}:${leaseId}:${at.toISOString()}`);
      },
      markFailed: async (id, leaseId, at, category) => {
        calls.push(`failed:${id}:${leaseId}:${at.toISOString()}:${category}`);
      },
      cleanup: async (cutoff, limit) => {
        calls.push(`cleanup:${cutoff.toISOString()}:${limit}`);
        return 3;
      },
    });
    const gateway = createGateway(async (value) => {
      calls.push(`deliver:${value.id}`);
      return value.id === 'delivered'
        ? { kind: 'delivered' }
        : { kind: 'permanent-failure', category: 'permission' };
    });
    const scheduler = schedulerFor({
      store,
      gateway,
      batchSize: 2,
      cleanupBatchSize: 3,
      leaseTimeoutMs: 5 * 60_000,
      retentionDays: 7,
      createLeaseId: () => 'lease-batch',
    });

    await scheduler.runNow();

    expect(calls).toEqual([
      'recover:2026-07-29T11:55:00.000Z:2026-07-29T12:00:00.000Z',
      'claim:2026-07-29T12:00:00.000Z:lease-batch:2',
      'deliver:delivered',
      'delivered:delivered:lease-batch:2026-07-29T12:00:00.000Z',
      'deliver:permanent',
      'failed:permanent:lease-batch:2026-07-29T12:00:00.000Z:permission',
      'cleanup:2026-07-22T12:00:00.000Z:3',
    ]);
    expect(scheduler.healthy).toBe(true);
  });

  it('schedules transient failures at one, five, and fifteen minutes, then fails the exhausted retry', async () => {
    const transitions: string[] = [];
    const store = createStore({
      claimDue: async () => [
        reminder('retry-one', { attemptCount: 0 }),
        reminder('retry-five', { attemptCount: 1 }),
        reminder('retry-fifteen', { attemptCount: 2 }),
        reminder('retry-exhausted', { attemptCount: 3 }),
      ],
      markRetry: async (id, _leaseId, attemptCount, nextAt, category) => {
        transitions.push(
          `retry:${id}:${attemptCount}:${nextAt.toISOString()}:${category}`,
        );
      },
      markFailed: async (id, _leaseId, at, category) => {
        transitions.push(`failed:${id}:${at.toISOString()}:${category}`);
      },
    });
    const scheduler = schedulerFor({
      store,
      gateway: createGateway(async () => ({
        kind: 'transient-failure',
        category: 'network',
      })),
    });

    await scheduler.runNow();

    expect(transitions).toEqual([
      'retry:retry-one:1:2026-07-29T12:01:00.000Z:network',
      'retry:retry-five:2:2026-07-29T12:05:00.000Z:network',
      'retry:retry-fifteen:3:2026-07-29T12:15:00.000Z:network',
      'failed:retry-exhausted:2026-07-29T12:00:00.000Z:network',
    ]);
    expect(scheduler.healthy).toBe(true);
  });

  it('persists a rejected gateway call as uncertain and does not repost it after lease expiry', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-scheduler-'));
    const store = new SQLiteReminderStore(join(directory, 'reminders.db'));
    let deliveryCount = 0;
    let currentNow = new Date('2026-07-29T12:00:00.000Z');
    const scheduler = schedulerFor({
      store,
      now: () => new Date(currentNow),
      gateway: createGateway(async () => {
        deliveryCount += 1;
        throw new Error('remote acceptance is unknown');
      }),
    });
    try {
      await store.create(
        {
          id: 'uncertain-reminder',
          guildId: 'guild-1',
          channelId: 'channel-1',
          ownerUserId: 'owner-1',
          message: 'Sensitive reminder text',
          dueAt: new Date('2026-07-29T12:00:00.000Z'),
          createdAt: new Date('2026-07-29T11:00:00.000Z'),
        },
        10,
      );

      await scheduler.runNow();
      expect(scheduler.healthy).toBe(false);
      currentNow = new Date('2026-07-29T12:10:00.000Z');
      await scheduler.runNow();

      expect(deliveryCount).toBe(1);
      expect(scheduler.healthy).toBe(true);
      await expect(
        store.listByOwner('guild-1', 'owner-1'),
      ).resolves.toMatchObject([
        { id: 'uncertain-reminder', status: 'delivery_uncertain' },
      ]);
    } finally {
      await store.closeConnection();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('contains individual delivery and state failures, continues the batch, and recovers health after a clean tick', async () => {
    const calls: string[] = [];
    const logs: Array<{
      readonly context: Record<string, unknown>;
      readonly message: string;
    }> = [];
    let claimed = true;
    const store = createStore({
      claimDue: async () => {
        if (!claimed) return [];
        claimed = false;
        return [
          reminder('gateway-error', {
            message: 'TOP SECRET gateway payload',
          }),
          reminder('state-error', {
            message: 'TOP SECRET state payload',
          }),
          reminder('continues'),
        ];
      },
      markDelivered: async (id) => {
        calls.push(`mark:${id}`);
        if (id === 'state-error') {
          throw new Error('TOP SECRET storage detail');
        }
      },
      markDeliveryUncertain: async (id) => {
        calls.push(`uncertain:${id}`);
      },
    });
    const scheduler = schedulerFor({
      store,
      gateway: createGateway(async (value) => {
        calls.push(`deliver:${value.id}`);
        if (value.id === 'gateway-error') {
          throw Object.assign(new Error('TOP SECRET gateway detail'), {
            code: 'USER_DERIVED_SECRET_CODE',
          });
        }
        return { kind: 'delivered' };
      }),
      logger: {
        info: (context, message) => logs.push({ context, message }),
        warn: (context, message) => logs.push({ context, message }),
      },
    });

    await scheduler.runNow();

    expect(calls).toEqual([
      'deliver:gateway-error',
      'uncertain:gateway-error',
      'deliver:state-error',
      'mark:state-error',
      'deliver:continues',
      'mark:continues',
    ]);
    expect(scheduler.healthy).toBe(false);
    expect(JSON.stringify(logs)).not.toContain('TOP SECRET');
    expect(JSON.stringify(logs)).not.toContain('USER_DERIVED_SECRET_CODE');
    expect(JSON.stringify(logs)).not.toContain('gateway-error');
    expect(JSON.stringify(logs)).not.toContain('state-error');
    expect(
      logs.filter(({ message }) =>
        message.includes('scheduler operation failed'),
      ),
    ).toEqual([
      {
        context: {
          operation: 'deliver',
          category: 'delivery',
          failureCount: 1,
        },
        message: 'Reminder scheduler operation failed.',
      },
      {
        context: {
          operation: 'persist_delivery_outcome',
          category: 'delivery-state',
          failureCount: 1,
        },
        message: 'Reminder scheduler operation failed.',
      },
    ]);

    await scheduler.runNow();
    expect(scheduler.healthy).toBe(true);
  });

  it('continues safe stages after storage failure and degrades health', async () => {
    const calls: string[] = [];
    const scheduler = schedulerFor({
      store: createStore({
        recoverExpiredClaims: async () => {
          calls.push('recover');
          throw new Error('storage unavailable');
        },
        claimDue: async () => {
          calls.push('claim');
          return [reminder('deliverable')];
        },
        markDelivered: async () => {
          calls.push('mark');
        },
        cleanup: async () => {
          calls.push('cleanup');
          throw new Error('cleanup unavailable');
        },
      }),
      gateway: createGateway(async () => {
        calls.push('deliver');
        return { kind: 'delivered' };
      }),
    });

    await expect(scheduler.runNow()).resolves.toBeUndefined();

    expect(calls).toEqual(['recover', 'claim', 'deliver', 'mark', 'cleanup']);
    expect(scheduler.healthy).toBe(false);
  });

  it('logs only content-free operation categories and aggregate counts', async () => {
    const logs: Array<{
      readonly level: 'info' | 'warn';
      readonly context: Record<string, unknown>;
      readonly message: string;
    }> = [];
    const scheduler = schedulerFor({
      store: createStore({
        recoverExpiredClaims: async () => 4,
        claimDue: async () => [
          reminder('sensitive-id', {
            guildId: 'sensitive-guild',
            channelId: 'sensitive-channel',
            ownerUserId: 'sensitive-owner',
            message: 'sensitive-message',
          }),
        ],
        markRetry: async () => undefined,
        cleanup: async () => 2,
      }),
      gateway: createGateway(async () => ({
        kind: 'transient-failure',
        category: 'rate-limit',
      })),
      logger: {
        info: (context, message) =>
          logs.push({ level: 'info', context, message }),
        warn: (context, message) =>
          logs.push({ level: 'warn', context, message }),
      },
    });

    await scheduler.runNow();

    expect(logs).toEqual([
      {
        level: 'info',
        context: {
          operation: 'reminder_scheduler',
          outcome: 'success',
          recoveredCount: 4,
          claimedCount: 1,
          deliveredCount: 0,
          retryCount: 1,
          failedCount: 0,
          uncertainCount: 0,
          cleanedCount: 2,
          failureCategoryCounts: {
            'rate-limit': 1,
          },
        },
        message: 'Reminder scheduler tick completed.',
      },
    ]);
    const serialized = JSON.stringify(logs);
    for (const sensitiveValue of [
      'sensitive-id',
      'sensitive-guild',
      'sensitive-channel',
      'sensitive-owner',
      'sensitive-message',
    ]) {
      expect(serialized).not.toContain(sensitiveValue);
    }
  });
});

function schedulerFor(
  overrides: Partial<ReminderSchedulerDependencies> = {},
): ReminderScheduler {
  return new ReminderScheduler({
    store: createStore(),
    gateway: createGateway(),
    now: () => new Date('2026-07-29T12:00:00.000Z'),
    createLeaseId: () => 'lease-1',
    ...overrides,
  });
}

function createStore(overrides: Partial<ReminderStore> = {}): ReminderStore {
  return {
    create: async (input) => ({
      ...input,
      status: 'pending',
      attemptCount: 0,
    }),
    listByOwner: async () => [],
    cancelOwned: async () => undefined,
    recoverExpiredClaims: async () => 0,
    claimDue: async () => [],
    markDelivered: async () => undefined,
    markRetry: async () => undefined,
    markFailed: async () => undefined,
    markDeliveryUncertain: async () => undefined,
    cleanup: async () => 0,
    statusCounts: async () => ({
      pending: 0,
      retryPending: 0,
      deliveryUncertain: 0,
      failed: 0,
    }),
    healthCheck: async () => true,
    closeConnection: async () => undefined,
    ...overrides,
  };
}

function createGateway(
  deliver: (
    reminder: ReminderView,
    now: Date,
  ) => Promise<ReminderDeliveryOutcome> = async () => ({ kind: 'delivered' }),
): ReminderDeliveryGateway {
  return {
    deliver,
  };
}

function reminder(
  id: string,
  overrides: Partial<ReminderView> = {},
): ReminderView {
  return {
    id,
    guildId: 'guild-1',
    channelId: 'channel-1',
    ownerUserId: 'owner-1',
    message: 'Check the oven',
    dueAt: new Date('2026-07-29T12:00:00.000Z'),
    status: 'claimed',
    attemptCount: 0,
    createdAt: new Date('2026-07-29T11:00:00.000Z'),
    ...overrides,
  };
}

function createTimers(): ReminderSchedulerTimers & {
  readonly callbacks: Array<() => void>;
  readonly delays: number[];
  readonly cleared: unknown[];
} {
  const callbacks: Array<() => void> = [];
  const delays: number[] = [];
  const cleared: unknown[] = [];
  return {
    callbacks,
    delays,
    cleared,
    setInterval: (callback, delayMs) => {
      callbacks.push(callback);
      delays.push(delayMs);
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
  return { promise, resolve: resolve! };
}
