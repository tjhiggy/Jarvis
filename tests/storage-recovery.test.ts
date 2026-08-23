import { copyFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SQLiteConversationStore } from '../src/storage/sqlite-conversation-store.js';
import { SQLiteEngagementRepository } from '../src/storage/engagement-sqlite.js';
import { SQLitePollStore } from '../src/polls/sqlite-poll-store.js';
import { SQLiteReminderStore } from '../src/reminders/sqlite-reminder-store.js';
import { SqliteBroadcastStore } from '../src/notifications/sqlite-broadcast-store.js';
import { RssStorage } from '../src/notifications/rss-storage.js';

/**
 * Disposable shared-database recovery rehearsal for v1.6 / #288.
 *
 * Covers conversation, engagement, poll, reminder, broadcast, and RSS schema
 * ownership on one temporary SQLite file. Never touches production data.
 */
describe('shared SQLite backup, restore, integrity, and rollback rehearsal', () => {
  let directory: string;
  let primaryPath: string;
  let backupPath: string;
  let restorePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'jarvis-storage-recovery-'));
    primaryPath = join(directory, 'jarvis.db');
    backupPath = join(directory, 'jarvis.backup.db');
    restorePath = join(directory, 'jarvis.restored.db');
  });

  afterEach(async () => {
    await rm(directory, { force: true, recursive: true });
  });

  it('migrates every schema owner, passes integrity, backs up, restores, and preserves sentinels', async () => {
    const now = new Date('2026-08-23T12:00:00.000Z');
    const guildId = 'guild-recovery-1';
    const channelId = 'channel-recovery-1';
    const userId = 'user-recovery-1';

    // 1. Open every major store against the same temporary path so all
    //    independent migrations run on one shared database.
    const conversation = new SQLiteConversationStore(primaryPath, 100);
    const engagement = new SQLiteEngagementRepository(primaryPath);
    const polls = new SQLitePollStore(primaryPath);
    const reminders = new SQLiteReminderStore(primaryPath);
    const broadcasts = new SqliteBroadcastStore(primaryPath);
    const rss = new RssStorage(primaryPath);

    try {
      // 2. Insert synthetic sentinel rows (no production content).
      await conversation.append({
        guildId,
        conversationId: channelId,
        userId,
        role: 'user',
        content: 'recovery-sentinel-conversation',
        timestamp: now,
      });

      await engagement.createIntroduction({
        id: 'intro-recovery-1',
        guildId,
        channelId,
        ownerUserId: userId,
        displayName: 'Recovery Crew',
        interests: 'testing',
        introduction: 'Synthetic introduction for recovery rehearsal.',
        messageId: '',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });

      await polls.reserve({
        id: 'poll-recovery-1',
        guildId,
        conversationId: channelId,
        channelId,
        creatorUserId: userId,
        question: 'Recovery sentinel poll?',
        options: ['yes', 'no'],
        closesAt: new Date(now.getTime() + 60_000),
        createdAt: now,
      });

      await reminders.create(
        {
          id: 'reminder-recovery-1',
          guildId,
          channelId,
          ownerUserId: userId,
          message: 'recovery-sentinel-reminder',
          dueAt: new Date(now.getTime() + 120_000),
          createdAt: now,
        },
        10,
      );

      await broadcasts.setPolicy({
        serverId: guildId,
        category: 'rss',
        state: 'enabled',
        channelId,
        timezone: 'UTC',
        minimumIntervalSeconds: 0,
        digestMode: true,
        updatedAt: now,
      });

      rss.addFeed(guildId, 'https://example.com/recovery-feed.xml', 'Recovery');
      rss.establishBaseline(guildId, 'https://example.com/recovery-feed.xml', [
        'item-1',
      ]);
    } finally {
      // 3. Clean shutdown of every connection before backup.
      await conversation.close();
      await engagement.closeConnection();
      await polls.closeConnection();
      await reminders.closeConnection();
      await broadcasts.close();
      rss.close();
    }

    // 4. Integrity check on the live primary before backup.
    expect(runIntegrityCheck(primaryPath)).toBe('ok');

    // 5. WAL checkpoint so the main file is self-contained, then copy.
    checkpointWal(primaryPath);
    await copyFile(primaryPath, backupPath);
    const backupChecksum = sha256File(backupPath);
    const backupSize = (await stat(backupPath)).size;
    expect(backupSize).toBeGreaterThan(0);

    // 6. Restore to a new path and verify integrity + sentinels.
    await copyFile(backupPath, restorePath);
    expect(runIntegrityCheck(restorePath)).toBe('ok');
    expect(sha256File(restorePath)).toBe(backupChecksum);

    const restoredConversation = new SQLiteConversationStore(restorePath, 100);
    const restoredEngagement = new SQLiteEngagementRepository(restorePath);
    const restoredPolls = new SQLitePollStore(restorePath);
    const restoredReminders = new SQLiteReminderStore(restorePath);
    const restoredBroadcasts = new SqliteBroadcastStore(restorePath);
    const restoredRss = new RssStorage(restorePath);

    try {
      const messages = await restoredConversation.getRecent(
        guildId,
        channelId,
        10,
      );
      expect(messages.map((row) => row.content)).toEqual([
        'recovery-sentinel-conversation',
      ]);

      const introduction = await restoredEngagement.getIntroduction(
        guildId,
        'intro-recovery-1',
      );
      expect(introduction?.introduction).toBe(
        'Synthetic introduction for recovery rehearsal.',
      );

      const poll = await restoredPolls.get('poll-recovery-1');
      expect(poll?.question).toBe('Recovery sentinel poll?');
      expect(poll?.status).toBe('creating');

      const reminderList = await restoredReminders.listByOwner(guildId, userId);
      expect(reminderList.map((row) => row.message)).toEqual([
        'recovery-sentinel-reminder',
      ]);

      const policy = await restoredBroadcasts.getPolicy(guildId, 'rss');
      expect(policy?.state).toBe('enabled');
      expect(policy?.channelId).toBe(channelId);

      const feeds = restoredRss.listFeeds(guildId);
      expect(feeds).toEqual([
        expect.objectContaining({
          url: 'https://example.com/recovery-feed.xml',
          label: 'Recovery',
          baselined: true,
        }),
      ]);
    } finally {
      await restoredConversation.close();
      await restoredEngagement.closeConnection();
      await restoredPolls.closeConnection();
      await restoredReminders.closeConnection();
      await restoredBroadcasts.close();
      restoredRss.close();
    }

    // 7. Failure-path proof: original backup remains usable after a
    //    second restore path is intentionally left alone / re-verified.
    expect(runIntegrityCheck(backupPath)).toBe('ok');
    expect(sha256File(backupPath)).toBe(backupChecksum);
  });

  it('classifies rollback of a newer schema as unsupported without matching application version', async () => {
    // Fresh current-schema database.
    const conversation = new SQLiteConversationStore(primaryPath);
    await conversation.close();

    const database = new Database(primaryPath);
    try {
      // Simulate a future application writing a higher user_version.
      database.pragma('user_version = 99');
      const futureVersion = database.pragma('user_version', {
        simple: true,
      }) as number;
      expect(futureVersion).toBe(99);
    } finally {
      database.close();
    }

    // Current application refuses databases newer than it supports.
    expect(() => new SQLiteConversationStore(primaryPath)).toThrow(
      /newer than supported/i,
    );

    // Explicit classification for operators (and the recovery matrix):
    // Rolling an upgraded database back to an older Jarvis binary is
    // unsupported. Restore a pre-upgrade backup taken with the matching
    // application version instead.
    const classification = classifySchemaRollback({
      databaseUserVersion: 99,
      applicationSupportedVersion: 1,
    });
    expect(classification).toEqual({
      compatible: false,
      action: 'restore_pre_upgrade_backup',
      reason:
        'Database schema is newer than this application supports. Restore a backup taken before the upgrade with a matching application version.',
    });
  });

  it('reopens the shared database idempotently after all schema owners migrate', async () => {
    const conversation = new SQLiteConversationStore(primaryPath);
    const engagement = new SQLiteEngagementRepository(primaryPath);
    const polls = new SQLitePollStore(primaryPath);
    const reminders = new SQLiteReminderStore(primaryPath);
    const broadcasts = new SqliteBroadcastStore(primaryPath);
    const rss = new RssStorage(primaryPath);

    await conversation.close();
    await engagement.closeConnection();
    await polls.closeConnection();
    await reminders.closeConnection();
    await broadcasts.close();
    rss.close();

    // Second full open cycle must not throw and must remain healthy.
    const conversation2 = new SQLiteConversationStore(primaryPath);
    const engagement2 = new SQLiteEngagementRepository(primaryPath);
    const polls2 = new SQLitePollStore(primaryPath);
    const reminders2 = new SQLiteReminderStore(primaryPath);
    const broadcasts2 = new SqliteBroadcastStore(primaryPath);
    const rss2 = new RssStorage(primaryPath);

    try {
      await expect(conversation2.healthCheck()).resolves.toBe(true);
      await expect(engagement2.healthCheck()).resolves.toBe(true);
      await expect(polls2.healthCheck()).resolves.toBe(true);
      await expect(reminders2.healthCheck()).resolves.toBe(true);
      expect(runIntegrityCheck(primaryPath)).toBe('ok');
      expect(rss2.listFeeds('any-server')).toEqual([]);
    } finally {
      await conversation2.close();
      await engagement2.closeConnection();
      await polls2.closeConnection();
      await reminders2.closeConnection();
      await broadcasts2.close();
      rss2.close();
    }
  });
});

function runIntegrityCheck(databasePath: string): string {
  const database = new Database(databasePath, { readonly: true });
  try {
    const result = database.pragma('integrity_check', {
      simple: true,
    }) as string;
    return result;
  } finally {
    database.close();
  }
}

function checkpointWal(databasePath: string): void {
  const database = new Database(databasePath);
  try {
    database.pragma('wal_checkpoint(FULL)');
  } finally {
    database.close();
  }
}

function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function classifySchemaRollback(input: {
  readonly databaseUserVersion: number;
  readonly applicationSupportedVersion: number;
}): {
  readonly compatible: boolean;
  readonly action: 'open' | 'restore_pre_upgrade_backup';
  readonly reason: string;
} {
  if (input.databaseUserVersion <= input.applicationSupportedVersion) {
    return {
      compatible: true,
      action: 'open',
      reason: 'Database schema is supported by this application version.',
    };
  }
  return {
    compatible: false,
    action: 'restore_pre_upgrade_backup',
    reason:
      'Database schema is newer than this application supports. Restore a backup taken before the upgrade with a matching application version.',
  };
}
