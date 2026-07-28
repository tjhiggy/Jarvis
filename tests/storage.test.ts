import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NewConversationMessage } from '../src/storage/conversation-store.js';
import { SQLiteConversationStore } from '../src/storage/sqlite-conversation-store.js';

describe('SQLiteConversationStore', () => {
  let directory: string;
  let databasePath: string;
  let store: SQLiteConversationStore;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'jarvis-storage-'));
    databasePath = join(directory, 'conversations.db');
    store = new SQLiteConversationStore(databasePath);
  });

  afterEach(async () => {
    await store.close();
    await rm(directory, { force: true, recursive: true });
  });

  it('migrates a new database to schema version 1', () => {
    const database = new Database(databasePath, { readonly: true });

    expect(database.pragma('user_version', { simple: true })).toBe(1);
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'conversation_messages_guild_conversation_created_at_id'",
        )
        .get(),
    ).toBeDefined();

    database.close();
  });

  it('returns appended messages in chronological order', async () => {
    await store.append(message({ content: 'first', timestamp: date(1) }));
    await store.append(message({ content: 'second', timestamp: date(2) }));

    const messages = await store.getRecent('guild-1', 'channel-1', 10);

    expect(messages.map((entry) => entry.content)).toEqual(['first', 'second']);
    expect(messages.map((entry) => entry.timestamp)).toEqual([
      date(1),
      date(2),
    ]);
  });

  it('returns the newest limit messages in chronological order', async () => {
    await store.append(message({ content: 'oldest', timestamp: date(1) }));
    await store.append(message({ content: 'middle', timestamp: date(2) }));
    await store.append(message({ content: 'newest', timestamp: date(3) }));

    const messages = await store.getRecent('guild-1', 'channel-1', 2);

    expect(messages.map((entry) => entry.content)).toEqual([
      'middle',
      'newest',
    ]);
  });

  it('evicts the oldest rows at the configured global storage bound', async () => {
    await store.close();
    store = new SQLiteConversationStore(databasePath, 2);

    await store.append(message({ content: 'oldest', timestamp: date(1) }));
    await store.append(message({ content: 'middle', timestamp: date(2) }));
    await store.append(message({ content: 'newest', timestamp: date(3) }));

    await expect(
      store.getRecent('guild-1', 'channel-1', 10),
    ).resolves.toMatchObject([{ content: 'middle' }, { content: 'newest' }]);
  });

  it('enforces the global storage bound across different conversations', async () => {
    await store.close();
    store = new SQLiteConversationStore(databasePath, 2);

    await store.append(
      message({
        content: 'oldest channel one',
        conversationId: 'channel-1',
        timestamp: date(1),
      }),
    );
    await store.append(
      message({
        content: 'middle channel two',
        conversationId: 'channel-2',
        timestamp: date(2),
      }),
    );
    await store.append(
      message({
        content: 'newest channel three',
        conversationId: 'channel-3',
        timestamp: date(3),
      }),
    );

    await expect(store.getRecent('guild-1', 'channel-1', 10)).resolves.toEqual(
      [],
    );
    await expect(
      store.getRecent('guild-1', 'channel-2', 10),
    ).resolves.toMatchObject([{ content: 'middle channel two' }]);
    await expect(
      store.getRecent('guild-1', 'channel-3', 10),
    ).resolves.toMatchObject([{ content: 'newest channel three' }]);
  });

  it('isolates identical conversation IDs between guilds', async () => {
    await store.append(message({ content: 'guild one', guildId: 'guild-1' }));
    await store.append(message({ content: 'guild two', guildId: 'guild-2' }));

    await expect(
      store.getRecent('guild-1', 'channel-1', 10),
    ).resolves.toMatchObject([{ content: 'guild one', guildId: 'guild-1' }]);
    await expect(
      store.getRecent('guild-2', 'channel-1', 10),
    ).resolves.toMatchObject([{ content: 'guild two', guildId: 'guild-2' }]);
  });

  it('isolates reads and deletion between conversations in one guild', async () => {
    await store.append(
      message({ content: 'channel one', conversationId: 'channel-1' }),
    );
    await store.append(
      message({ content: 'channel two', conversationId: 'channel-2' }),
    );

    await expect(
      store.getRecent('guild-1', 'channel-1', 10),
    ).resolves.toMatchObject([
      { content: 'channel one', conversationId: 'channel-1' },
    ]);
    await expect(store.clear('guild-1', 'channel-1')).resolves.toBe(1);
    await expect(
      store.getRecent('guild-1', 'channel-2', 10),
    ).resolves.toMatchObject([
      { content: 'channel two', conversationId: 'channel-2' },
    ]);
  });

  it('clears only the requested guild conversation and returns the deleted count', async () => {
    await store.append(message({ content: 'remove me' }));
    await store.append(message({ content: 'leave me', guildId: 'guild-2' }));

    await expect(store.clear('guild-1', 'channel-1')).resolves.toBe(1);
    await expect(store.getRecent('guild-1', 'channel-1', 10)).resolves.toEqual(
      [],
    );
    await expect(
      store.getRecent('guild-2', 'channel-1', 10),
    ).resolves.toMatchObject([{ content: 'leave me' }]);
  });

  it('removes messages older than the retention cutoff', async () => {
    await store.append(message({ content: 'expired', timestamp: date(1) }));
    await store.append(message({ content: 'retained', timestamp: date(2) }));

    await expect(store.cleanup(date(2))).resolves.toBe(1);
    await expect(
      store.getRecent('guild-1', 'channel-1', 10),
    ).resolves.toMatchObject([{ content: 'retained' }]);
  });

  it('persists an optional OpenAI response ID', async () => {
    await store.append(
      message({ openaiResponseId: 'resp_123', role: 'assistant' }),
    );

    await expect(
      store.getRecent('guild-1', 'channel-1', 10),
    ).resolves.toMatchObject([
      { openaiResponseId: 'resp_123', role: 'assistant' },
    ]);
  });

  it('reports a healthy open database connection', async () => {
    await expect(store.healthCheck()).resolves.toBe(true);
  });

  it('stores quote-heavy content without changing the query', async () => {
    const content =
      'O\'Brien said: "drop table conversation_messages;" -- nope';

    await store.append(message({ content }));

    await expect(
      store.getRecent('guild-1', 'channel-1', 10),
    ).resolves.toMatchObject([{ content }]);
  });
});

function date(seconds: number): Date {
  return new Date(`2026-07-27T00:00:0${seconds}.000Z`);
}

function message(
  overrides: Partial<NewConversationMessage> = {},
): NewConversationMessage {
  return {
    guildId: 'guild-1',
    conversationId: 'channel-1',
    userId: 'user-1',
    role: 'user',
    content: 'hello',
    timestamp: date(1),
    ...overrides,
  };
}
