import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import type { BroadcastPolicy } from '../src/notifications/broadcast-store.js';
import { SqliteBroadcastStore } from '../src/notifications/sqlite-broadcast-store.js';

describe('SqliteBroadcastStore', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true })),
    );
  });

  it('isolates durable policy by server and preserves it across reopen', async () => {
    const path = await databasePath(directories);
    const first = new SqliteBroadcastStore(path);
    await first.setPolicy(policy({ serverId: 'server-a' }));
    await first.close();

    const reopened = new SqliteBroadcastStore(path);
    await expect(reopened.getPolicy('server-a', 'rss')).resolves.toMatchObject({
      state: 'enabled',
      channelId: 'channel',
    });
    await expect(
      reopened.getPolicy('server-b', 'rss'),
    ).resolves.toBeUndefined();
    await reopened.close();
  });

  it('migrates broadcast storage so trivia policy and delivery fencing are durable', async () => {
    const path = await databasePath(directories);
    const store = new SqliteBroadcastStore(path);
    await store.setPolicy(
      policy({ category: 'trivia', channelId: 'activity' }),
    );
    const lease = await store.claimDelivery(
      'server',
      'trivia',
      'round-1',
      date(0),
    );
    await store.close();

    const reopened = new SqliteBroadcastStore(path);
    await expect(reopened.getPolicy('server', 'trivia')).resolves.toMatchObject(
      {
        state: 'enabled',
        channelId: 'activity',
      },
    );
    await expect(
      reopened.completeDelivery('server', 'trivia', 'round-1', lease!, date(1)),
    ).resolves.toBe(true);
    await reopened.close();
  });

  it('persists member preferences and never removes them during delivery cleanup', async () => {
    const store = new SqliteBroadcastStore(await databasePath(directories));
    const now = date(0);
    await store.setPolicy(policy());
    await store.setMemberPreference({
      serverId: 'server',
      userId: 'crew-member',
      category: 'birthday',
      enabled: true,
      updatedAt: now,
    });
    const token = await store.claimDelivery('server', 'rss', 'terminal', now);
    await store.completeDelivery('server', 'rss', 'terminal', token!, date(1));

    await expect(store.cleanup(date(2), 10)).resolves.toBe(1);
    await expect(store.getPolicy('server', 'rss')).resolves.toMatchObject({
      state: 'enabled',
    });
    await expect(
      store.getMemberPreference('server', 'crew-member', 'birthday'),
    ).resolves.toMatchObject({ enabled: true });
    await store.close();
  });

  it('persists the latest completed delivery per server and category', async () => {
    const path = await databasePath(directories);
    const first = new SqliteBroadcastStore(path);
    const serverToken = await first.claimDelivery(
      'server',
      'rss',
      'item-a',
      date(0),
    );
    await first.completeDelivery(
      'server',
      'rss',
      'item-a',
      serverToken!,
      date(1),
    );
    const otherToken = await first.claimDelivery(
      'other-server',
      'rss',
      'item-b',
      date(2),
    );
    await first.completeDelivery(
      'other-server',
      'rss',
      'item-b',
      otherToken!,
      date(3),
    );
    await first.close();

    const reopened = new SqliteBroadcastStore(path);
    try {
      await expect(
        reopened.getLatestCompletedAt('server', 'rss'),
      ).resolves.toEqual(date(1));
      await expect(
        reopened.getLatestCompletedAt('other-server', 'rss'),
      ).resolves.toEqual(date(3));
      await expect(
        reopened.getLatestCompletedAt('server', 'recap'),
      ).resolves.toBeUndefined();
    } finally {
      await reopened.close();
    }
  });

  it('fences stale delivery completion with the active lease token', async () => {
    const path = await databasePath(directories);
    const first = new SqliteBroadcastStore(path);
    const now = date(0);
    const afterLeaseExpiry = date(5 * 60 + 1);
    const a = await first.claimDelivery('server', 'rss', 'item', now);
    await first.close();

    const reopened = new SqliteBroadcastStore(path);
    const b = await reopened.claimDelivery(
      'server',
      'rss',
      'item',
      afterLeaseExpiry,
    );

    expect(a).toEqual(expect.any(String));
    expect(b).toEqual(expect.any(String));
    expect(b).not.toBe(a);
    await expect(
      reopened.completeDelivery('server', 'rss', 'item', a!, afterLeaseExpiry),
    ).resolves.toBe(false);
    await expect(
      reopened.completeDelivery('server', 'rss', 'item', b!, afterLeaseExpiry),
    ).resolves.toBe(true);
    await reopened.close();
  });

  it('does not complete a delivery after its lease has expired', async () => {
    const store = new SqliteBroadcastStore(await databasePath(directories));
    const token = await store.claimDelivery(
      'server',
      'rss',
      'expired',
      date(0),
    );
    const afterLeaseExpiry = date(5 * 60 + 1);

    try {
      await expect(
        store.completeDelivery(
          'server',
          'rss',
          'expired',
          token!,
          afterLeaseExpiry,
        ),
      ).resolves.toBe(false);
      await expect(
        store.releaseDelivery(
          'server',
          'rss',
          'expired',
          token!,
          afterLeaseExpiry,
        ),
      ).resolves.toBe(false);
    } finally {
      await store.close();
    }
  });

  it('returns a leased failure to pending and exposes only bounded delivery health', async () => {
    const store = new SqliteBroadcastStore(await databasePath(directories));
    const now = date(0);
    const token = await store.claimDelivery('server', 'rss', 'retryable', now);

    await expect(
      store.releaseDelivery(
        'server',
        'rss',
        'retryable',
        token!,
        date(1),
        'network',
      ),
    ).resolves.toBe(true);
    await expect(
      store.deliveryHealth('server', 'rss', 'retryable'),
    ).resolves.toEqual({
      status: 'pending',
      claimedAt: now,
      errorCategory: 'network',
    });
    await expect(
      store.claimDelivery('server', 'rss', 'retryable', date(2)),
    ).resolves.toEqual(expect.any(String));
    await store.close();
  });

  it('projects only the latest category delivery health without exposing a delivery key', async () => {
    const store = new SqliteBroadcastStore(await databasePath(directories));
    try {
      const first = await store.claimDelivery(
        'server',
        'rss',
        'first-key',
        date(0),
      );
      await store.completeDelivery(
        'server',
        'rss',
        'first-key',
        first!,
        date(1),
      );
      const latest = await store.claimDelivery(
        'server',
        'rss',
        'latest-key',
        date(2),
      );
      await store.releaseDelivery(
        'server',
        'rss',
        'latest-key',
        latest!,
        date(3),
        'network',
      );

      await expect(
        store.latestDeliveryHealth('server', 'rss'),
      ).resolves.toEqual({
        status: 'pending',
        claimedAt: date(2),
        errorCategory: 'network',
      });
    } finally {
      await store.close();
    }
  });

  it('uses category and state constraints in the durable schema', async () => {
    const path = await databasePath(directories);
    const store = new SqliteBroadcastStore(path);
    await store.close();
    const database = new Database(path);

    expect(() =>
      database
        .prepare(
          `INSERT INTO broadcast_policies (
            server_id, category, state, channel_id, timezone,
            minimum_interval_seconds, digest_mode, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('server', 'not-a-category', 'enabled', 'channel', 'UTC', 0, 0, 0),
    ).toThrow();
    expect(() =>
      database
        .prepare(
          `INSERT INTO broadcast_policies (
            server_id, category, state, channel_id, timezone,
            minimum_interval_seconds, digest_mode, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('server', 'rss', 'not-a-state', 'channel', 'UTC', 0, 0, 0),
    ).toThrow();
    database.close();
  });
});

function policy(overrides: Partial<BroadcastPolicy> = {}): BroadcastPolicy {
  return {
    serverId: 'server',
    category: 'rss',
    state: 'enabled',
    channelId: 'channel',
    timezone: 'America/New_York',
    minimumIntervalSeconds: 0,
    digestMode: false,
    updatedAt: date(0),
    ...overrides,
  };
}

function date(seconds: number): Date {
  return new Date(Date.UTC(2026, 7, 11, 16, 0, seconds));
}

async function databasePath(directories: string[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-broadcast-'));
  directories.push(directory);
  return join(directory, 'broadcasts.db');
}
