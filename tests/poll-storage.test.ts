import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  PollReservationConflictError,
  PollVoteTargetMismatchError,
} from '../src/polls/poll-store.js';
import { SQLitePollStore } from '../src/polls/sqlite-poll-store.js';
import type { PollView } from '../src/polls/poll-types.js';

describe('SQLitePollStore', () => {
  let directory: string;
  let databasePath: string;
  let store: SQLitePollStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'jarvis-polls-'));
    databasePath = join(directory, 'polls.db');
    store = new SQLitePollStore(databasePath);
  });

  afterEach(async () => {
    await store.closeConnection();
    await rm(directory, { force: true, recursive: true });
  });

  it('adds poll tables without changing the conversation schema version', async () => {
    const preservedPath = join(directory, 'existing-conversations.db');
    const existing = new Database(preservedPath);
    existing.pragma('user_version = 17');
    existing.close();
    const separateStore = new SQLitePollStore(preservedPath);
    await separateStore.closeConnection();
    const database = new Database(preservedPath, { readonly: true });
    expect(database.pragma('user_version', { simple: true })).toBe(17);
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get('polls'),
    ).toBeDefined();
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get('poll_options'),
    ).toBeDefined();
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get('poll_votes'),
    ).toBeDefined();
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get('poll_schema_migrations'),
    ).toBeDefined();
    expect(
      database.prepare('SELECT version FROM poll_schema_migrations').all(),
    ).toEqual([{ version: 1 }, { version: 2 }]);
    database.close();
  });

  it('reserves and activates a complete parameterized Unicode poll view', async () => {
    const reserved = await store.reserve(poll());
    expect(reserved).toMatchObject({
      id: 'poll00000001',
      status: 'creating',
      syncState: 'pending',
      parentChannelId: 'parent-1',
      question: 'O\'Brien "🚀"',
      options: [
        { index: 0, label: 'Yes', voteCount: 0 },
        { index: 1, label: 'No -- never', voteCount: 0 },
      ],
    });
    await expect(store.countCapacityOccupying()).resolves.toBe(1);

    const active = await store.activate('poll00000001', 'message-1');
    expect(active).toMatchObject({
      status: 'active',
      messageId: 'message-1',
      syncState: 'synced',
      closesAt: date(60),
    });
    await expect(store.countCapacityOccupying()).resolves.toBe(1);
    await expect(
      store.hasActiveByCreatorInConversation('creator-1', 'conversation-1'),
    ).resolves.toBe(true);
  });

  it('reconciles a creating poll after restart without attempting Discord delivery', async () => {
    await store.reserve(poll());
    await store.closeConnection();
    store = new SQLitePollStore(databasePath);

    await expect(store.recoverCreating()).resolves.toBe(1);
    await expect(store.countCapacityOccupying()).resolves.toBe(0);
    await expect(
      store.hasActiveByCreatorInConversation('creator-1', 'conversation-1'),
    ).resolves.toBe(false);
    await expect(store.get('poll00000001')).resolves.toMatchObject({
      status: 'failed',
    });
  });

  it('atomically allows only one creating or active poll per creator conversation', async () => {
    const secondStore = new SQLitePollStore(databasePath);
    try {
      const results = await Promise.allSettled([
        store.reserve(poll({ id: 'poll00000001' })),
        secondStore.reserve(poll({ id: 'poll00000002' })),
      ]);
      const fulfilled = results.filter(
        (result): result is PromiseFulfilledResult<PollView> =>
          result.status === 'fulfilled',
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toBeInstanceOf(PollReservationConflictError);
    } finally {
      await secondStore.closeConnection();
    }
  });

  it('records initial, repeated, and changed votes with exact aggregate counts', async () => {
    await activateDefaultPoll(store);
    const initial = await store.recordVote(vote());
    const repeated = await store.recordVote(vote());
    const changed = await store.recordVote(vote({ optionIndex: 1 }));

    expect(initial.kind).toBe('recorded');
    expect(repeated.kind).toBe('unchanged');
    expect(changed).toMatchObject({
      kind: 'changed',
      poll: {
        options: [
          { index: 0, voteCount: 0 },
          { index: 1, voteCount: 1 },
        ],
      },
    });
  });

  it.each([
    ['guild', { guildId: 'guild-2' }],
    ['channel', { channelId: 'channel-2' }],
    ['message', { messageId: 'message-2' }],
  ] as const)(
    'rejects a mismatched %s target before persisting a vote',
    async (_target, mismatch) => {
      await activateDefaultPoll(store);

      await expect(store.recordVote(vote(mismatch))).rejects.toBeInstanceOf(
        PollVoteTargetMismatchError,
      );

      const database = new Database(databasePath, { readonly: true });
      expect(database.prepare('SELECT * FROM poll_votes').all()).toEqual([]);
      database.close();
      const pollView = await store.close('poll00000001', date(10));
      expect(pollView.options.map((option) => option.voteCount)).toEqual([
        0, 0,
      ]);
    },
  );

  it('rejects votes for invalid options and polls that are expired or closed', async () => {
    await activateDefaultPoll(store);
    await expect(store.recordVote(vote({ optionIndex: 2 }))).rejects.toThrow(
      /option/i,
    );
    await expect(store.recordVote(vote({ now: date(60) }))).rejects.toThrow(
      /closed/i,
    );
    await store.close('poll00000001', date(10));
    await expect(store.recordVote(vote())).rejects.toThrow(/closed/i);
  });

  it('never persists raw voter identifiers', async () => {
    await activateDefaultPoll(store);
    await store.recordVote(vote({ voterKey: 'hmac-only-key' }));
    const database = new Database(databasePath, { readonly: true });
    const columns = database.prepare('PRAGMA table_info(poll_votes)').all() as {
      name: string;
    }[];
    const stored = database
      .prepare('SELECT voter_key FROM poll_votes')
      .all() as { voter_key: string }[];
    expect(columns.map((column) => column.name)).not.toContain('user_id');
    expect(stored).toEqual([{ voter_key: 'hmac-only-key' }]);
    database.close();
  });

  it('keeps concurrent changes as valid aggregate totals', async () => {
    await activateDefaultPoll(store);
    await Promise.all([
      store.recordVote(vote({ voterKey: 'key-a', optionIndex: 0 })),
      store.recordVote(vote({ voterKey: 'key-a', optionIndex: 1 })),
      store.recordVote(vote({ voterKey: 'key-b', optionIndex: 1 })),
    ]);
    const finalVote = await store.recordVote(vote({ voterKey: 'key-c' }));
    const totals = finalVote.poll.options.map((option) => option.voteCount);
    expect(totals.every((count) => count >= 0)).toBe(true);
    expect(totals.reduce((sum, count) => sum + count, 0)).toBe(3);
  });

  it('closes idempotently and removes voter keys while preserving aggregates', async () => {
    await activateDefaultPoll(store);
    await store.recordVote(vote());
    await store.recordVote(vote({ voterKey: 'key-b', optionIndex: 1 }));

    const closed = await store.close('poll00000001', date(10));
    const repeated = await store.close('poll00000001', date(20));
    expect(closed).toMatchObject({
      status: 'closed',
      closedAt: date(10),
      options: [
        { index: 0, voteCount: 1 },
        { index: 1, voteCount: 1 },
      ],
    });
    expect(repeated).toEqual(closed);
    const database = new Database(databasePath, { readonly: true });
    expect(database.prepare('SELECT * FROM poll_votes').all()).toEqual([]);
    database.close();
  });

  it('closes due polls and orders pending synchronization by next retry', async () => {
    await store.reserve(poll({ id: 'poll00000001', closesAt: date(10) }));
    await store.activate('poll00000001', 'message-1');
    await store.reserve(
      poll({
        id: 'poll00000002',
        conversationId: 'conversation-2',
        closesAt: date(100),
      }),
    );
    await store.activate('poll00000002', 'message-2');
    await store.markPendingSync('poll00000002', date(30));
    await store.markPendingSync('poll00000001', date(20));

    const due = await store.closeDue(date(10), 10);
    const pending = await store.listPendingSync(date(30), 10);
    expect(due.map((entry) => entry.id)).toEqual(['poll00000001']);
    expect(pending.map((entry) => entry.id)).toEqual([
      'poll00000001',
      'poll00000002',
    ]);
    expect(pending[0]).toMatchObject({ syncAttempts: 1, nextSyncAt: date(20) });
  });

  it('marks synchronization or orphaning and cleans terminal polls with cascades', async () => {
    await activateDefaultPoll(store);
    await store.markPendingSync('poll00000001', date(20));
    await store.markSynced('poll00000001');
    await expect(store.listPendingSync(date(30), 10)).resolves.toEqual([]);
    await store.markOrphaned('poll00000001');
    await expect(store.countCapacityOccupying()).resolves.toBe(0);
    await expect(store.cleanup(new Date(Date.now() + 1_000))).resolves.toBe(1);
    const database = new Database(databasePath, { readonly: true });
    expect(database.prepare('SELECT * FROM poll_options').all()).toEqual([]);
    database.close();
  });

  it('reports health while open and false after closing the connection', async () => {
    await expect(store.healthCheck()).resolves.toBe(true);
    await store.closeConnection();
    await expect(store.healthCheck()).resolves.toBe(false);
  });

  it('closes the opened database when migration fails', async () => {
    const failingPath = join(directory, 'migration-failure.db');
    const database = new Database(failingPath);
    database.exec('CREATE TABLE polls (id TEXT PRIMARY KEY)');
    database.close();

    expect(() => new SQLitePollStore(failingPath)).toThrow();
    await expect(rm(failingPath, { force: true })).resolves.toBeUndefined();
  });
});

function date(seconds: number): Date {
  return new Date(Date.UTC(2026, 6, 29, 0, 0, seconds));
}

function poll(
  overrides: Partial<{
    id: string;
    conversationId: string;
    closesAt: Date;
    createdAt: Date;
  }> = {},
) {
  return {
    id: 'poll00000001',
    guildId: 'guild-1',
    conversationId: 'conversation-1',
    channelId: 'channel-1',
    parentChannelId: 'parent-1',
    creatorUserId: 'creator-1',
    question: 'O\'Brien "🚀"',
    options: ['Yes', 'No -- never'],
    closesAt: date(60),
    createdAt: date(1),
    ...overrides,
  };
}

function vote(
  overrides: Partial<{
    pollId: string;
    guildId: string;
    channelId: string;
    messageId: string;
    voterKey: string;
    optionIndex: number;
    now: Date;
  }> = {},
) {
  return {
    pollId: 'poll00000001',
    guildId: 'guild-1',
    channelId: 'channel-1',
    messageId: 'message-1',
    voterKey: 'voter-key-a',
    optionIndex: 0,
    now: date(5),
    ...overrides,
  };
}

async function activateDefaultPoll(store: SQLitePollStore): Promise<void> {
  await store.reserve(poll());
  await store.activate('poll00000001', 'message-1');
}
