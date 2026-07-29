import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ReminderActiveLimitError } from '../src/reminders/reminder-store.js';
import { SQLiteReminderStore } from '../src/reminders/sqlite-reminder-store.js';

describe('SQLiteReminderStore schema and creation', () => {
  let directory: string;
  let databasePath: string;
  let store: SQLiteReminderStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'jarvis-reminders-'));
    databasePath = join(directory, 'nested', 'reminders.db');
    store = new SQLiteReminderStore(databasePath);
  });

  afterEach(async () => {
    await store.closeConnection();
    await rm(directory, { force: true, recursive: true });
  });

  it('creates the containing directory and tracks migrations outside user_version', () => {
    const database = new Database(databasePath, { readonly: true });

    expect(database.pragma('user_version', { simple: true })).toBe(0);
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reminder_schema_migrations'",
        )
        .get(),
    ).toBeDefined();
    expect(
      database
        .prepare('SELECT version FROM reminder_schema_migrations ORDER BY version')
        .all(),
    ).toEqual([{ version: 1 }]);
    database.close();
  });

  it('preserves an existing user_version when opening the same database', async () => {
    await store.closeConnection();
    await mkdir(dirname(databasePath), { recursive: true });
    const database = new Database(databasePath);
    database.pragma('user_version = 42');
    database.close();

    store = new SQLiteReminderStore(databasePath);
    const reopened = new Database(databasePath, { readonly: true });
    expect(reopened.pragma('user_version', { simple: true })).toBe(42);
    reopened.close();
  });

  it('parameterizes reminder creation and round-trips every view field', async () => {
    const created = await store.create(
      reminder({
        message: "O'Brien said: \"drop table reminders;\" -- nope",
        parentChannelId: 'parent-1',
      }),
      10,
    );

    expect(created).toEqual({
      id: 'reminder-1',
      guildId: 'guild-1',
      channelId: 'thread-1',
      parentChannelId: 'parent-1',
      ownerUserId: 'user-1',
      message: "O'Brien said: \"drop table reminders;\" -- nope",
      dueAt: date(60),
      status: 'pending',
      attemptCount: 0,
      createdAt: date(0),
    });
  });

  it('throws at the eleventh active reminder for one guild and owner', async () => {
    for (let index = 1; index <= 10; index += 1) {
      await store.create(reminder({ id: `reminder-${index}` }), 10);
    }

    await expect(store.create(reminder({ id: 'reminder-11' }), 10)).rejects.toBeInstanceOf(
      ReminderActiveLimitError,
    );
  });

  it('tracks active limits independently by guild and owner', async () => {
    for (let index = 1; index <= 10; index += 1) {
      await store.create(reminder({ id: `owner-one-${index}` }), 10);
    }

    await expect(
      store.create(reminder({ id: 'owner-two', ownerUserId: 'user-2' }), 10),
    ).resolves.toMatchObject({ ownerUserId: 'user-2' });
    await expect(
      store.create(reminder({ id: 'guild-two', guildId: 'guild-2' }), 10),
    ).resolves.toMatchObject({ guildId: 'guild-2' });
  });
});

describe('SQLiteReminderStore claims and lifecycle', () => {
  let directory: string;
  let store: SQLiteReminderStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'jarvis-reminders-'));
    store = new SQLiteReminderStore(join(directory, 'reminders.db'));
  });

  afterEach(async () => {
    await store.closeConnection();
    await rm(directory, { force: true, recursive: true });
  });

  it('claims only due pending and retry reminders ordered by due time and ID', async () => {
    await store.create(reminder({ id: 'same-time-b', dueAt: date(10) }), 10);
    await store.create(reminder({ id: 'same-time-a', dueAt: date(10) }), 10);
    await store.create(reminder({ id: 'future', dueAt: date(20) }), 10);
    await store.create(reminder({ id: 'retry', dueAt: date(5) }), 10);
    await store.claimDue(date(5), 'lease-retry', 1);
    await store.markRetry(
      'retry',
      'lease-retry',
      1,
      date(10),
      'network',
    );

    await expect(store.claimDue(date(10), 'lease-one', 2)).resolves.toMatchObject([
      { id: 'retry', status: 'claimed' },
      { id: 'same-time-a', status: 'claimed' },
    ]);
    await expect(store.claimDue(date(10), 'lease-two', 10)).resolves.toMatchObject([
      { id: 'same-time-b', status: 'claimed' },
    ]);
  });

  it('requires the active lease for every post-delivery transition', async () => {
    const ids = ['delivered', 'retry', 'failed', 'uncertain'];
    for (const id of ids) {
      await store.create(reminder({ id }), 10);
    }
    await store.claimDue(date(60), 'lease-one', 10);

    await expect(
      store.markDelivered('delivered', 'wrong-lease', date(61)),
    ).rejects.toThrow('Reminder state conflict.');
    await store.markDelivered('delivered', 'lease-one', date(61));
    await store.markRetry('retry', 'lease-one', 2, date(62), 'rate-limit');
    await store.markFailed('failed', 'lease-one', date(63), 'permission');
    await store.markDeliveryUncertain('uncertain', 'lease-one', date(64));

    await expect(store.listByOwner('guild-1', 'user-1')).resolves.toMatchObject([
      { id: 'delivered', status: 'delivered', deliveredAt: date(61) },
      { id: 'failed', status: 'failed', failedAt: date(63) },
      {
        id: 'retry',
        status: 'retry_pending',
        attemptCount: 2,
        nextAttemptAt: date(62),
      },
      { id: 'uncertain', status: 'delivery_uncertain' },
    ]);
  });

  it('recovers expired claims but never automatically reclaims uncertain delivery', async () => {
    await store.create(reminder({ id: 'expired' }), 10);
    await store.create(reminder({ id: 'uncertain' }), 10);
    await store.claimDue(date(60), 'lease-one', 10);
    await store.markDeliveryUncertain('uncertain', 'lease-one', date(61));

    await expect(store.recoverExpiredClaims(date(61), date(70))).resolves.toBe(1);
    await expect(store.claimDue(date(70), 'lease-two', 10)).resolves.toMatchObject([
      { id: 'expired', status: 'claimed' },
    ]);
    await expect(store.claimDue(date(70), 'lease-three', 10)).resolves.toEqual([]);
  });

  it('cleans up only terminal rows before a seven-day-compatible cutoff in a bounded batch', async () => {
    await store.create(reminder({ id: 'delivered' }), 10);
    await store.create(reminder({ id: 'cancelled' }), 10);
    await store.create(reminder({ id: 'pending' }), 10);
    await store.claimDue(date(60), 'lease-one', 10);
    await store.markDelivered('delivered', 'lease-one', date(61));
    await store.cancelOwned('guild-1', 'user-1', 'cancelled', date(61));

    await expect(store.cleanup(date(62), 1)).resolves.toBe(1);
    await expect(store.cleanup(date(62), 10)).resolves.toBe(1);
    await expect(store.listByOwner('guild-1', 'user-1')).resolves.toMatchObject([
      { id: 'pending', status: 'claimed' },
    ]);
  });

  it('returns aggregate-only status counts', async () => {
    await store.create(reminder({ id: 'pending', dueAt: date(90) }), 10);
    await store.create(reminder({ id: 'retry' }), 10);
    await store.create(reminder({ id: 'uncertain' }), 10);
    await store.create(reminder({ id: 'failed' }), 10);
    await store.claimDue(date(60), 'lease-one', 10);
    await store.markRetry('retry', 'lease-one', 1, date(70), 'network');
    await store.markDeliveryUncertain('uncertain', 'lease-one', date(61));
    await store.markFailed('failed', 'lease-one', date(61), 'service');

    await expect(store.statusCounts()).resolves.toEqual({
      pending: 1,
      retryPending: 1,
      deliveryUncertain: 1,
      failed: 1,
    });
  });

  it('reports health and closes idempotently', async () => {
    await expect(store.healthCheck()).resolves.toBe(true);
    await store.closeConnection();
    await store.closeConnection();
    await expect(store.healthCheck()).resolves.toBe(false);
  });
});

function date(minutes: number): Date {
  return new Date(Date.parse('2026-07-29T12:00:00.000Z') + minutes * 60_000);
}

function reminder(overrides: Partial<{
  id: string;
  guildId: string;
  channelId: string;
  parentChannelId?: string;
  ownerUserId: string;
  message: string;
  dueAt: Date;
  createdAt: Date;
}> = {}) {
  return {
    id: 'reminder-1',
    guildId: 'guild-1',
    channelId: 'thread-1',
    ownerUserId: 'user-1',
    message: 'Check the oven',
    dueAt: date(60),
    createdAt: date(0),
    ...overrides,
  };
}
