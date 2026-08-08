import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SQLiteEngagementRepository } from '../src/storage/engagement-sqlite.js';

describe('SQLiteEngagementRepository', () => {
  let directory: string;
  let databasePath: string;
  let repository: SQLiteEngagementRepository;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'jarvis-engagement-'));
    databasePath = join(directory, 'nested', 'engagement.db');
    repository = new SQLiteEngagementRepository(databasePath);
  });

  afterEach(async () => {
    await repository.closeConnection();
    await rm(directory, { force: true, recursive: true });
  });

  it('migrates an empty database with the engagement tables and indexes', async () => {
    const database = new Database(databasePath, { readonly: true });
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'engagement_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>;

    expect(tables.map((row) => row.name)).toEqual([
      'engagement_events',
      'engagement_idempotency_keys',
      'engagement_introductions',
      'engagement_opt_outs',
      'engagement_rsvps',
      'engagement_schema_migrations',
      'engagement_suggestions',
    ]);
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'engagement_events_status_scheduled'",
        )
        .get(),
    ).toBeDefined();
    database.close();
  });

  it('upgrades legacy global IDs to guild-scoped keys without dropping rows', async () => {
    const legacyPath = join(directory, 'legacy.db');
    const legacy = new Database(legacyPath);
    legacy.exec(`
      CREATE TABLE engagement_schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      INSERT INTO engagement_schema_migrations VALUES (1, 0);
      CREATE TABLE engagement_introductions (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, display_name TEXT NOT NULL, interests TEXT NOT NULL, introduction TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE engagement_suggestions (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE engagement_events (id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, scheduled_at INTEGER NOT NULL, timezone TEXT NOT NULL, capacity INTEGER NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE engagement_rsvps (event_id TEXT NOT NULL REFERENCES engagement_events(id) ON DELETE CASCADE, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, response TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (event_id, user_id));
      CREATE TABLE engagement_opt_outs (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, opted_out_at INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id));
      CREATE TABLE engagement_idempotency_keys (guild_id TEXT NOT NULL, scope TEXT NOT NULL, key TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (guild_id, scope, key));
      INSERT INTO engagement_events VALUES ('legacy-event', 'guild-1', 'channel-1', 'admin-1', 'Legacy', 'Preserved', 0, 'UTC', 1, 'completed', 0, 0);
      INSERT INTO engagement_rsvps VALUES ('legacy-event', 'guild-1', 'user-1', 'yes', 0, 0);
    `);
    legacy.close();

    const migrated = new SQLiteEngagementRepository(legacyPath);
    try {
      await expect(
        migrated.getEvent('guild-1', 'legacy-event'),
      ).resolves.toMatchObject({ title: 'Legacy' });
      await expect(
        migrated.createEvent(event({ id: 'legacy-event', guildId: 'guild-2' })),
      ).resolves.toMatchObject({ guildId: 'guild-2' });
    } finally {
      await migrated.closeConnection();
    }
  });

  it('migrates duplicate legacy active introductions by retaining the newest and queuing the other card for safe cleanup', async () => {
    const legacyPath = join(directory, 'duplicate-active.db');
    const legacy = new Database(legacyPath);
    legacy.exec(`
      CREATE TABLE engagement_schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      INSERT INTO engagement_schema_migrations VALUES (1, 0), (2, 0), (3, 0);
      CREATE TABLE engagement_introductions (id TEXT NOT NULL, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, display_name TEXT NOT NULL, interests TEXT NOT NULL, introduction TEXT NOT NULL, message_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK (status IN ('active', 'deleted')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (guild_id, id));
      INSERT INTO engagement_introductions VALUES ('old', 'guild-1', 'channel-1', 'user-1', 'Old', 'Cats', 'Old hello', 'message-old', 'active', 1, 1);
      INSERT INTO engagement_introductions VALUES ('new', 'guild-1', 'channel-1', 'user-1', 'New', 'Dogs', 'New hello', 'message-new', 'active', 2, 2);
    `);
    legacy.close();

    const migrated = new SQLiteEngagementRepository(legacyPath);
    try {
      await expect(
        migrated.getIntroduction('guild-1', 'new'),
      ).resolves.toMatchObject({ status: 'active' });
      await expect(
        migrated.getIntroduction('guild-1', 'old'),
      ).resolves.toMatchObject({
        status: 'cleanup_pending',
        messageId: 'message-old',
      });
    } finally {
      await migrated.closeConnection();
    }
  });

  it('creates, reads, and changes engagement record statuses without using text as identity', async () => {
    await repository.createIntroduction(introduction());
    await repository.createSuggestion(suggestion());
    await repository.createEvent(event());

    await expect(
      repository.updateIntroductionStatus(
        'guild-1',
        'user-1',
        'intro-1',
        'deleted',
        at(2),
      ),
    ).resolves.toMatchObject({ status: 'deleted' });
    await expect(
      repository.updateSuggestionStatus(
        'guild-1',
        'suggestion-1',
        'acknowledged',
        at(2),
      ),
    ).resolves.toMatchObject({ status: 'acknowledged' });
    await expect(
      repository.updateEventStatus('guild-1', 'event-1', 'cancelled', at(2)),
    ).resolves.toMatchObject({ status: 'cancelled' });
    await expect(
      repository.getIntroduction('guild-1', 'intro-1'),
    ).resolves.toMatchObject({ id: 'intro-1', ownerUserId: 'user-1' });
    await expect(
      repository.getSuggestion('guild-1', 'suggestion-1'),
    ).resolves.toMatchObject({ title: 'Build a launch bay' });
    await expect(
      repository.getEvent('guild-1', 'event-1'),
    ).resolves.toMatchObject({ scheduledAt: at(60), status: 'cancelled' });
  });

  it('rejects duplicate stable IDs and active duplicate suggestion content', async () => {
    await repository.createSuggestion(suggestion());
    await expect(repository.createSuggestion(suggestion())).rejects.toThrow(
      'Engagement record already exists.',
    );
    await expect(
      repository.createSuggestion(suggestion({ id: 'suggestion-2' })),
    ).rejects.toThrow('Engagement record already exists.');
    await expect(
      repository.createSuggestion(
        suggestion({ id: 'suggestion-2', title: 'Different idea' }),
      ),
    ).resolves.toMatchObject({ id: 'suggestion-2' });
  });

  it('atomically permits only one concurrent active suggestion with the same content', async () => {
    const results = await Promise.allSettled([
      repository.createSuggestion(suggestion({ id: 'suggestion-race-1' })),
      repository.createSuggestion(suggestion({ id: 'suggestion-race-2' })),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
  });

  it('atomically claims only an open owner suggestion for deletion', async () => {
    await repository.createSuggestion(suggestion());
    await repository.updateSuggestionStatus(
      'guild-1',
      'suggestion-1',
      'acknowledged',
      at(2),
    );
    await expect(
      repository.claimOpenSuggestionForDeletion(
        'guild-1',
        'user-1',
        'suggestion-1',
        at(3),
      ),
    ).resolves.toBeUndefined();
    await expect(
      repository.getSuggestion('guild-1', 'suggestion-1'),
    ).resolves.toMatchObject({ status: 'acknowledged' });
  });

  it('retains cleanup-pending suggestion message IDs across a SQLite reopen', async () => {
    await repository.createSuggestion(suggestion());
    await repository.markSuggestionCleanupPending(
      'guild-1',
      'suggestion-1',
      'message-ghost',
      at(2),
    );
    await repository.closeConnection();
    repository = new SQLiteEngagementRepository(databasePath);
    await expect(repository.listCleanupPendingSuggestions(10)).resolves.toEqual(
      [
        expect.objectContaining({
          id: 'suggestion-1',
          messageId: 'message-ghost',
          status: 'cleanup_pending',
        }),
      ],
    );
  });

  it('persists opt-outs and rejects further collection for that guild and owner', async () => {
    await repository.setOptOut({
      guildId: 'guild-1',
      userId: 'user-1',
      optedOutAt: at(1),
    });
    await expect(
      repository.getOptOut('guild-1', 'user-1'),
    ).resolves.toMatchObject({ optedOutAt: at(1) });
    await expect(repository.createIntroduction(introduction())).rejects.toThrow(
      'Engagement collection is disabled for this member.',
    );
  });

  it('isolates identically named owners and records between guilds', async () => {
    await repository.createSuggestion(
      suggestion({ id: 'guild-one', guildId: 'guild-1' }),
    );
    await repository.createSuggestion(
      suggestion({ id: 'guild-two', guildId: 'guild-2' }),
    );
    await repository.setOptOut({
      guildId: 'guild-2',
      userId: 'user-1',
      optedOutAt: at(1),
    });

    await expect(
      repository.getSuggestion('guild-2', 'guild-one'),
    ).resolves.toBeUndefined();
    await expect(
      repository.getOptOut('guild-1', 'user-1'),
    ).resolves.toBeUndefined();
    await expect(repository.deleteOwnerData('guild-1', 'user-1')).resolves.toBe(
      1,
    );
    await expect(
      repository.getSuggestion('guild-2', 'guild-two'),
    ).resolves.toMatchObject({ id: 'guild-two' });
  });

  it('allows the same stable IDs in separate guilds and scopes RSVP uniqueness to the guild event', async () => {
    await repository.createIntroduction(
      introduction({ id: 'shared-intro', guildId: 'guild-1' }),
    );
    await repository.createIntroduction(
      introduction({ id: 'shared-intro', guildId: 'guild-2' }),
    );
    await repository.createSuggestion(
      suggestion({ id: 'shared-suggestion', guildId: 'guild-1' }),
    );
    await repository.createSuggestion(
      suggestion({ id: 'shared-suggestion', guildId: 'guild-2' }),
    );
    await repository.createEvent(
      event({ id: 'shared-event', guildId: 'guild-1' }),
    );
    await repository.createEvent(
      event({ id: 'shared-event', guildId: 'guild-2' }),
    );

    await repository.upsertRsvp(
      rsvp({ eventId: 'shared-event', guildId: 'guild-1', response: 'yes' }),
    );
    await repository.upsertRsvp(
      rsvp({ eventId: 'shared-event', guildId: 'guild-2', response: 'no' }),
    );

    await expect(
      repository.getIntroduction('guild-2', 'shared-intro'),
    ).resolves.toMatchObject({ guildId: 'guild-2' });
    await expect(
      repository.getSuggestion('guild-2', 'shared-suggestion'),
    ).resolves.toMatchObject({ guildId: 'guild-2' });
  });

  it('deletes owner-created events and cascades their RSVPs within the same guild', async () => {
    await repository.createEvent(
      event({ id: 'owned-event', ownerUserId: 'user-1' }),
    );
    await repository.createEvent(
      event({
        id: 'other-guild-event',
        guildId: 'guild-2',
        ownerUserId: 'user-1',
      }),
    );
    await repository.upsertRsvp(
      rsvp({ eventId: 'owned-event', userId: 'user-2' }),
    );

    await expect(repository.deleteOwnerData('guild-1', 'user-1')).resolves.toBe(
      1,
    );
    await expect(
      repository.getEvent('guild-1', 'owned-event'),
    ).resolves.toBeUndefined();
    await expect(
      repository.getEvent('guild-2', 'other-guild-event'),
    ).resolves.toMatchObject({ id: 'other-guild-event' });
    const database = new Database(databasePath, { readonly: true });
    expect(
      database
        .prepare(
          "SELECT * FROM engagement_rsvps WHERE event_id = 'owned-event'",
        )
        .all(),
    ).toEqual([]);
    database.close();
  });

  it('stores RSVP and callback or job keys idempotently', async () => {
    await repository.createEvent(event());
    await expect(repository.upsertRsvp(rsvp())).resolves.toMatchObject({
      response: 'yes',
    });
    await expect(
      repository.upsertRsvp(rsvp({ response: 'maybe', updatedAt: at(2) })),
    ).resolves.toMatchObject({ response: 'maybe' });
    await expect(
      repository.claimIdempotencyKey(
        'guild-1',
        'interaction',
        'button-1',
        at(10),
      ),
    ).resolves.toBe(true);
    await expect(
      repository.claimIdempotencyKey(
        'guild-1',
        'interaction',
        'button-1',
        at(10),
      ),
    ).resolves.toBe(false);
    await expect(
      repository.claimIdempotencyKey(
        'guild-1',
        'scheduled-job',
        'recap-2026-08-08',
        at(10),
      ),
    ).resolves.toBe(true);
  });

  it('cleans expired retained records and keys but preserves current records', async () => {
    await repository.createIntroduction(
      introduction({ id: 'old-intro', createdAt: at(0), updatedAt: at(0) }),
    );
    await repository.createSuggestion(
      suggestion({
        id: 'current-suggestion',
        createdAt: at(20),
        updatedAt: at(20),
      }),
    );
    await repository.createEvent(
      event({
        id: 'old-event',
        status: 'completed',
        scheduledAt: at(0),
        createdAt: at(0),
        updatedAt: at(0),
      }),
    );
    await repository.claimIdempotencyKey(
      'guild-1',
      'scheduled-job',
      'old-job',
      at(0),
    );

    await expect(repository.cleanup(at(10), 10)).resolves.toBe(2);
    await expect(
      repository.getIntroduction('guild-1', 'old-intro'),
    ).resolves.toMatchObject({ status: 'active' });
    await expect(
      repository.getEvent('guild-1', 'old-event'),
    ).resolves.toBeUndefined();
    await expect(
      repository.getSuggestion('guild-1', 'current-suggestion'),
    ).resolves.toMatchObject({ id: 'current-suggestion' });
  });

  it('cleans expired opt-out markers so retention does not keep them forever', async () => {
    await repository.setOptOut({
      guildId: 'guild-1',
      userId: 'former-member',
      optedOutAt: at(0),
    });

    await expect(repository.cleanup(at(10), 10)).resolves.toBe(1);
    await expect(
      repository.getOptOut('guild-1', 'former-member'),
    ).resolves.toBeUndefined();
  });

  it('retains newer cross-guild records that share IDs with expired records', async () => {
    await repository.createIntroduction(
      introduction({ id: 'shared-retention', updatedAt: at(0) }),
    );
    await repository.createIntroduction(
      introduction({
        id: 'shared-retention',
        guildId: 'guild-2',
        updatedAt: at(20),
      }),
    );
    await repository.createSuggestion(
      suggestion({ id: 'shared-retention', updatedAt: at(0) }),
    );
    await repository.createSuggestion(
      suggestion({
        id: 'shared-retention',
        guildId: 'guild-2',
        updatedAt: at(20),
      }),
    );
    await repository.createEvent(
      event({ id: 'shared-retention', status: 'completed', updatedAt: at(0) }),
    );
    await repository.createEvent(
      event({ id: 'shared-retention', guildId: 'guild-2', updatedAt: at(20) }),
    );

    await expect(repository.cleanup(at(10), 10)).resolves.toBe(2);
    await expect(
      repository.getIntroduction('guild-2', 'shared-retention'),
    ).resolves.toBeDefined();
    await expect(
      repository.getSuggestion('guild-2', 'shared-retention'),
    ).resolves.toBeDefined();
    await expect(
      repository.getEvent('guild-2', 'shared-retention'),
    ).resolves.toBeDefined();
  });

  it('rejects event creation for opted-out owners and unbounded storage values', async () => {
    await repository.setOptOut({
      guildId: 'guild-1',
      userId: 'admin-1',
      optedOutAt: at(1),
    });
    await expect(repository.createEvent(event())).rejects.toThrow(
      'Engagement collection is disabled for this member.',
    );
    await expect(
      repository.createSuggestion(suggestion({ title: 'x'.repeat(201) })),
    ).rejects.toThrow('title must not exceed 200 characters.');
    await expect(
      repository.createIntroduction(introduction({ id: '' })),
    ).rejects.toThrow('id must not be empty.');
  });
});

function at(minutes: number): Date {
  return new Date(Date.parse('2026-08-08T12:00:00.000Z') + minutes * 60_000);
}

function introduction(overrides: Record<string, unknown> = {}) {
  return {
    id: 'intro-1',
    guildId: 'guild-1',
    channelId: 'channel-1',
    ownerUserId: 'user-1',
    displayName: 'Ripley',
    interests: 'Space cats',
    introduction: 'Here for the crew.',
    status: 'active' as const,
    createdAt: at(1),
    updatedAt: at(1),
    ...overrides,
  };
}

function suggestion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'suggestion-1',
    guildId: 'guild-1',
    channelId: 'channel-1',
    ownerUserId: 'user-1',
    title: 'Build a launch bay',
    description: 'With actual guardrails.',
    status: 'open' as const,
    createdAt: at(1),
    updatedAt: at(1),
    ...overrides,
  };
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1',
    guildId: 'guild-1',
    channelId: 'channel-1',
    ownerUserId: 'admin-1',
    title: 'Crew briefing',
    description: 'Bring coffee.',
    scheduledAt: at(60),
    timezone: 'America/New_York',
    capacity: 12,
    status: 'scheduled' as const,
    createdAt: at(1),
    updatedAt: at(1),
    ...overrides,
  };
}

function rsvp(overrides: Record<string, unknown> = {}) {
  return {
    eventId: 'event-1',
    guildId: 'guild-1',
    userId: 'user-1',
    response: 'yes' as const,
    createdAt: at(1),
    updatedAt: at(1),
    ...overrides,
  };
}
