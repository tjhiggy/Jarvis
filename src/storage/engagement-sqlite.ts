import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type {
  EngagementOptOut,
  Event,
  EventStatus,
  Introduction,
  IntroductionStatus,
  Rsvp,
  RsvpResponse,
  Suggestion,
  SuggestionStatus,
} from '../engagement/domain.js';
import {
  EngagementOptOutError,
  EngagementRecordConflictError,
  type EngagementIdempotencyScope,
  type EngagementRepository,
} from '../engagement/storage.js';

interface IntroductionRow {
  id: string;
  guild_id: string;
  channel_id: string;
  owner_user_id: string;
  display_name: string;
  interests: string;
  introduction: string;
  status: IntroductionStatus;
  created_at: number;
  updated_at: number;
}
interface SuggestionRow {
  id: string;
  guild_id: string;
  channel_id: string;
  owner_user_id: string;
  title: string;
  description: string;
  status: SuggestionStatus;
  created_at: number;
  updated_at: number;
}
interface EventRow {
  id: string;
  guild_id: string;
  channel_id: string;
  owner_user_id: string;
  title: string;
  description: string;
  scheduled_at: number;
  timezone: string;
  capacity: number;
  status: EventStatus;
  created_at: number;
  updated_at: number;
}
interface RsvpRow {
  event_id: string;
  guild_id: string;
  user_id: string;
  response: RsvpResponse;
  created_at: number;
  updated_at: number;
}
interface OptOutRow {
  guild_id: string;
  user_id: string;
  opted_out_at: number;
}

export class SQLiteEngagementRepository implements EngagementRepository {
  private readonly database: Database.Database;
  private closed = false;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    try {
      this.configure();
      this.migrate();
    } catch (error) {
      this.database.close();
      this.closed = true;
      throw error;
    }
  }

  async createIntroduction(input: Introduction): Promise<Introduction> {
    this.ensureOpen();
    const value = copyIntroduction(input);
    validateIntroduction(value);
    this.assertNotOptedOut(value.guildId, value.ownerUserId);
    try {
      this.database
        .prepare(
          `INSERT INTO engagement_introductions (id, guild_id, channel_id, owner_user_id, display_name, interests, introduction, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          value.id,
          value.guildId,
          value.channelId,
          value.ownerUserId,
          value.displayName,
          value.interests,
          value.introduction,
          value.status,
          milliseconds(value.createdAt),
          milliseconds(value.updatedAt),
        );
    } catch (error) {
      this.handleConflict(error);
    }
    return value;
  }

  async getIntroduction(
    guildId: string,
    id: string,
  ): Promise<Introduction | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        'SELECT * FROM engagement_introductions WHERE guild_id = ? AND id = ?',
      )
      .get(guildId, id) as IntroductionRow | undefined;
    return row === undefined ? undefined : toIntroduction(row);
  }

  async updateIntroductionStatus(
    guildId: string,
    ownerUserId: string,
    id: string,
    status: IntroductionStatus,
    updatedAt: Date,
  ): Promise<Introduction | undefined> {
    this.ensureOpen();
    this.database
      .prepare(
        'UPDATE engagement_introductions SET status = ?, updated_at = ? WHERE guild_id = ? AND owner_user_id = ? AND id = ?',
      )
      .run(status, milliseconds(updatedAt), guildId, ownerUserId, id);
    return this.getIntroduction(guildId, id);
  }

  async createSuggestion(input: Suggestion): Promise<Suggestion> {
    this.ensureOpen();
    const value = copySuggestion(input);
    validateSuggestion(value);
    this.assertNotOptedOut(value.guildId, value.ownerUserId);
    try {
      this.database
        .prepare(
          `INSERT INTO engagement_suggestions (id, guild_id, channel_id, owner_user_id, title, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          value.id,
          value.guildId,
          value.channelId,
          value.ownerUserId,
          value.title,
          value.description,
          value.status,
          milliseconds(value.createdAt),
          milliseconds(value.updatedAt),
        );
    } catch (error) {
      this.handleConflict(error);
    }
    return value;
  }

  async getSuggestion(
    guildId: string,
    id: string,
  ): Promise<Suggestion | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        'SELECT * FROM engagement_suggestions WHERE guild_id = ? AND id = ?',
      )
      .get(guildId, id) as SuggestionRow | undefined;
    return row === undefined ? undefined : toSuggestion(row);
  }

  async updateSuggestionStatus(
    guildId: string,
    id: string,
    status: SuggestionStatus,
    updatedAt: Date,
  ): Promise<Suggestion | undefined> {
    this.ensureOpen();
    this.database
      .prepare(
        'UPDATE engagement_suggestions SET status = ?, updated_at = ? WHERE guild_id = ? AND id = ?',
      )
      .run(status, milliseconds(updatedAt), guildId, id);
    return this.getSuggestion(guildId, id);
  }

  async createEvent(input: Event): Promise<Event> {
    this.ensureOpen();
    const value = copyEvent(input);
    validateEvent(value);
    this.assertNotOptedOut(value.guildId, value.ownerUserId);
    try {
      this.database
        .prepare(
          `INSERT INTO engagement_events (id, guild_id, channel_id, owner_user_id, title, description, scheduled_at, timezone, capacity, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          value.id,
          value.guildId,
          value.channelId,
          value.ownerUserId,
          value.title,
          value.description,
          milliseconds(value.scheduledAt),
          value.timezone,
          value.capacity,
          value.status,
          milliseconds(value.createdAt),
          milliseconds(value.updatedAt),
        );
    } catch (error) {
      this.handleConflict(error);
    }
    return value;
  }

  async getEvent(guildId: string, id: string): Promise<Event | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare('SELECT * FROM engagement_events WHERE guild_id = ? AND id = ?')
      .get(guildId, id) as EventRow | undefined;
    return row === undefined ? undefined : toEvent(row);
  }

  async updateEventStatus(
    guildId: string,
    id: string,
    status: EventStatus,
    updatedAt: Date,
  ): Promise<Event | undefined> {
    this.ensureOpen();
    this.database
      .prepare(
        'UPDATE engagement_events SET status = ?, updated_at = ? WHERE guild_id = ? AND id = ?',
      )
      .run(status, milliseconds(updatedAt), guildId, id);
    return this.getEvent(guildId, id);
  }

  async upsertRsvp(input: Rsvp): Promise<Rsvp> {
    this.ensureOpen();
    const value = copyRsvp(input);
    validateRsvp(value);
    this.assertNotOptedOut(value.guildId, value.userId);
    const event = await this.getEvent(value.guildId, value.eventId);
    if (event === undefined) throw new Error('Event not found.');
    this.database
      .prepare(
        `INSERT INTO engagement_rsvps (event_id, guild_id, user_id, response, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(guild_id, event_id, user_id) DO UPDATE SET response = excluded.response, updated_at = excluded.updated_at`,
      )
      .run(
        value.eventId,
        value.guildId,
        value.userId,
        value.response,
        milliseconds(value.createdAt),
        milliseconds(value.updatedAt),
      );
    const row = this.database
      .prepare(
        'SELECT * FROM engagement_rsvps WHERE guild_id = ? AND event_id = ? AND user_id = ?',
      )
      .get(value.guildId, value.eventId, value.userId) as RsvpRow;
    return toRsvp(row);
  }

  async getOptOut(
    guildId: string,
    userId: string,
  ): Promise<EngagementOptOut | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        'SELECT * FROM engagement_opt_outs WHERE guild_id = ? AND user_id = ?',
      )
      .get(guildId, userId) as OptOutRow | undefined;
    return row === undefined
      ? undefined
      : {
          guildId: row.guild_id,
          userId: row.user_id,
          optedOutAt: new Date(row.opted_out_at),
        };
  }

  async setOptOut(input: EngagementOptOut): Promise<EngagementOptOut> {
    this.ensureOpen();
    const value = { ...input, optedOutAt: copyDate(input.optedOutAt) };
    validateIdentifiers(value);
    this.database
      .prepare(
        `INSERT INTO engagement_opt_outs (guild_id, user_id, opted_out_at) VALUES (?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET opted_out_at = excluded.opted_out_at`,
      )
      .run(value.guildId, value.userId, milliseconds(value.optedOutAt));
    return value;
  }

  async deleteOwnerData(guildId: string, userId: string): Promise<number> {
    this.ensureOpen();
    return this.database.transaction(() => {
      const introductions = this.database
        .prepare(
          'DELETE FROM engagement_introductions WHERE guild_id = ? AND owner_user_id = ?',
        )
        .run(guildId, userId).changes;
      const suggestions = this.database
        .prepare(
          'DELETE FROM engagement_suggestions WHERE guild_id = ? AND owner_user_id = ?',
        )
        .run(guildId, userId).changes;
      const rsvps = this.database
        .prepare(
          'DELETE FROM engagement_rsvps WHERE guild_id = ? AND user_id = ?',
        )
        .run(guildId, userId).changes;
      const events = this.database
        .prepare(
          'DELETE FROM engagement_events WHERE guild_id = ? AND owner_user_id = ?',
        )
        .run(guildId, userId).changes;
      const optOut = this.database
        .prepare(
          'DELETE FROM engagement_opt_outs WHERE guild_id = ? AND user_id = ?',
        )
        .run(guildId, userId).changes;
      return introductions + suggestions + rsvps + events + optOut;
    })();
  }

  async claimIdempotencyKey(
    guildId: string,
    scope: EngagementIdempotencyScope,
    key: string,
    createdAt: Date,
  ): Promise<boolean> {
    this.ensureOpen();
    validateIdentifier('guildId', guildId);
    validateBoundedText('key', key, 256);
    try {
      this.database
        .prepare(
          'INSERT INTO engagement_idempotency_keys (guild_id, scope, key, created_at) VALUES (?, ?, ?, ?)',
        )
        .run(guildId, scope, key, milliseconds(createdAt));
      return true;
    } catch (error) {
      if (isConstraint(error)) return false;
      throw error;
    }
  }

  async cleanup(cutoff: Date, limit: number): Promise<number> {
    this.ensureOpen();
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw new RangeError(
        'Cleanup limit must be a non-negative safe integer.',
      );
    const cutoffMilliseconds = milliseconds(cutoff);
    return this.database.transaction(() => {
      let remaining = limit;
      let changes = 0;
      for (const sql of [
        `DELETE FROM engagement_introductions WHERE id IN (SELECT id FROM engagement_introductions WHERE updated_at < ? ORDER BY updated_at ASC, id ASC LIMIT ?)`,
        `DELETE FROM engagement_suggestions WHERE id IN (SELECT id FROM engagement_suggestions WHERE updated_at < ? ORDER BY updated_at ASC, id ASC LIMIT ?)`,
        `DELETE FROM engagement_events WHERE id IN (SELECT id FROM engagement_events WHERE status IN ('cancelled', 'completed') AND updated_at < ? ORDER BY updated_at ASC, id ASC LIMIT ?)`,
        `DELETE FROM engagement_idempotency_keys WHERE rowid IN (SELECT rowid FROM engagement_idempotency_keys WHERE created_at < ? ORDER BY created_at ASC, key ASC LIMIT ?)`,
        `DELETE FROM engagement_opt_outs WHERE rowid IN (SELECT rowid FROM engagement_opt_outs WHERE opted_out_at < ? ORDER BY opted_out_at ASC, guild_id ASC, user_id ASC LIMIT ?)`,
      ]) {
        if (remaining === 0) break;
        const result = this.database
          .prepare(sql)
          .run(cutoffMilliseconds, remaining);
        changes += result.changes;
        remaining -= result.changes;
      }
      return changes;
    })();
  }

  async healthCheck(): Promise<boolean> {
    if (this.closed) return false;
    try {
      this.database.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }
  async closeConnection(): Promise<void> {
    if (!this.closed) {
      this.database.close();
      this.closed = true;
    }
  }

  private configure(): void {
    this.database.pragma('journal_mode = WAL');
    this.database.pragma('foreign_keys = ON');
    this.database.pragma('busy_timeout = 5000');
    this.database.pragma('synchronous = NORMAL');
  }
  private migrate(): void {
    this.database.transaction(() => {
      this.database
        .prepare(
          'CREATE TABLE IF NOT EXISTS engagement_schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)',
        )
        .run();
      if (!this.hasMigration(1)) {
        this.createSchema();
        this.recordMigration(1);
      }
      if (!this.hasMigration(2)) {
        if (!this.hasGuildScopedPrimaryKeys()) this.upgradeLegacySchema();
        this.recordMigration(2);
      }
    })();
  }

  private hasMigration(version: number): boolean {
    return (
      this.database
        .prepare('SELECT 1 FROM engagement_schema_migrations WHERE version = ?')
        .get(version) !== undefined
    );
  }

  private recordMigration(version: number): void {
    this.database
      .prepare(
        'INSERT INTO engagement_schema_migrations (version, applied_at) VALUES (?, ?)',
      )
      .run(version, Date.now());
  }

  private hasGuildScopedPrimaryKeys(): boolean {
    const eventKeys = this.database
      .prepare('PRAGMA table_info(engagement_events)')
      .all() as Array<{ name: string; pk: number }>;
    return (
      eventKeys.some(
        (column) => column.name === 'guild_id' && column.pk === 1,
      ) && eventKeys.some((column) => column.name === 'id' && column.pk === 2)
    );
  }

  private upgradeLegacySchema(): void {
    this.database.exec(`
      ALTER TABLE engagement_rsvps RENAME TO engagement_rsvps_legacy;
      ALTER TABLE engagement_introductions RENAME TO engagement_introductions_legacy;
      ALTER TABLE engagement_suggestions RENAME TO engagement_suggestions_legacy;
      ALTER TABLE engagement_events RENAME TO engagement_events_legacy;
      DROP INDEX IF EXISTS engagement_introductions_status_retention;
      DROP INDEX IF EXISTS engagement_suggestions_status_retention;
      DROP INDEX IF EXISTS engagement_events_status_scheduled;
      DROP INDEX IF EXISTS engagement_events_retention;
      DROP INDEX IF EXISTS engagement_rsvps_guild_user;
    `);
    this.createSchema();
    this.database.exec(`
      INSERT INTO engagement_introductions SELECT * FROM engagement_introductions_legacy;
      INSERT INTO engagement_suggestions SELECT * FROM engagement_suggestions_legacy;
      INSERT INTO engagement_events SELECT * FROM engagement_events_legacy;
      INSERT INTO engagement_rsvps SELECT * FROM engagement_rsvps_legacy;
      DROP TABLE engagement_rsvps_legacy;
      DROP TABLE engagement_introductions_legacy;
      DROP TABLE engagement_suggestions_legacy;
      DROP TABLE engagement_events_legacy;
    `);
  }

  private createSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS engagement_introductions (id TEXT NOT NULL, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, display_name TEXT NOT NULL, interests TEXT NOT NULL, introduction TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active', 'deleted')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (guild_id, id));
      CREATE TABLE IF NOT EXISTS engagement_suggestions (id TEXT NOT NULL, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'deferred', 'resolved', 'archived')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (guild_id, id));
      CREATE TABLE IF NOT EXISTS engagement_events (id TEXT NOT NULL, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, scheduled_at INTEGER NOT NULL, timezone TEXT NOT NULL, capacity INTEGER NOT NULL CHECK (capacity > 0), status TEXT NOT NULL CHECK (status IN ('scheduled', 'cancelled', 'completed')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (guild_id, id));
      CREATE TABLE IF NOT EXISTS engagement_rsvps (event_id TEXT NOT NULL, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, response TEXT NOT NULL CHECK (response IN ('yes', 'maybe', 'no')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (guild_id, event_id, user_id), FOREIGN KEY (guild_id, event_id) REFERENCES engagement_events(guild_id, id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS engagement_opt_outs (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, opted_out_at INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id));
      CREATE TABLE IF NOT EXISTS engagement_idempotency_keys (guild_id TEXT NOT NULL, scope TEXT NOT NULL CHECK (scope IN ('interaction', 'scheduled-job')), key TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (guild_id, scope, key));
      CREATE INDEX IF NOT EXISTS engagement_introductions_status_retention ON engagement_introductions (status, updated_at, id);
      CREATE INDEX IF NOT EXISTS engagement_suggestions_status_retention ON engagement_suggestions (status, updated_at, id);
      CREATE INDEX IF NOT EXISTS engagement_events_status_scheduled ON engagement_events (status, scheduled_at, id);
      CREATE INDEX IF NOT EXISTS engagement_events_retention ON engagement_events (status, updated_at, id);
      CREATE INDEX IF NOT EXISTS engagement_rsvps_guild_user ON engagement_rsvps (guild_id, user_id, event_id);
      CREATE INDEX IF NOT EXISTS engagement_idempotency_retention ON engagement_idempotency_keys (created_at, key);
      CREATE INDEX IF NOT EXISTS engagement_opt_outs_retention ON engagement_opt_outs (opted_out_at, guild_id, user_id);
    `);
  }
  private assertNotOptedOut(guildId: string, userId: string): void {
    if (
      this.database
        .prepare(
          'SELECT 1 FROM engagement_opt_outs WHERE guild_id = ? AND user_id = ?',
        )
        .get(guildId, userId) !== undefined
    )
      throw new EngagementOptOutError(
        'Engagement collection is disabled for this member.',
      );
  }
  private handleConflict(error: unknown): never {
    if (isConstraint(error))
      throw new EngagementRecordConflictError(
        'Engagement record already exists.',
      );
    throw error;
  }
  private ensureOpen(): void {
    if (this.closed) throw new Error('Engagement repository is closed.');
  }
}

function validateIntroduction(value: Introduction): void {
  validateIdentifiers(value);
  validateBoundedText('displayName', value.displayName, 100);
  validateBoundedText('interests', value.interests, 500);
  validateBoundedText('introduction', value.introduction, 2_000);
}

function validateSuggestion(value: Suggestion): void {
  validateIdentifiers(value);
  validateBoundedText('title', value.title, 200);
  validateBoundedText('description', value.description, 2_000);
}

function validateEvent(value: Event): void {
  validateIdentifiers(value);
  validateBoundedText('title', value.title, 200);
  validateBoundedText('description', value.description, 2_000);
  validateBoundedText('timezone', value.timezone, 100);
  if (!Number.isSafeInteger(value.capacity) || value.capacity < 1) {
    throw new RangeError('capacity must be a positive safe integer.');
  }
}

function validateRsvp(value: Rsvp): void {
  validateIdentifier('eventId', value.eventId);
  validateIdentifier('guildId', value.guildId);
  validateIdentifier('userId', value.userId);
}

function validateIdentifiers(value: {
  readonly guildId: string;
  readonly ownerUserId?: string;
  readonly channelId?: string;
  readonly id?: string;
  readonly userId?: string;
}): void {
  validateIdentifier('guildId', value.guildId);
  if (value.id !== undefined) validateIdentifier('id', value.id);
  if (value.channelId !== undefined)
    validateIdentifier('channelId', value.channelId);
  if (value.ownerUserId !== undefined) {
    validateIdentifier('ownerUserId', value.ownerUserId);
  }
  if (value.userId !== undefined) validateIdentifier('userId', value.userId);
}

function validateIdentifier(name: string, value: string): void {
  validateBoundedText(name, value, 128);
}

function validateBoundedText(
  name: string,
  value: string,
  maximum: number,
): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RangeError(`${name} must not be empty.`);
  }
  if (value.length > maximum) {
    throw new RangeError(`${name} must not exceed ${maximum} characters.`);
  }
}

function isConstraint(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { code?: string }).code?.startsWith('SQLITE_CONSTRAINT') === true
  );
}
function milliseconds(value: Date): number {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new TypeError('Expected a finite Date.');
  return value.getTime();
}
function copyDate(value: Date): Date {
  return new Date(milliseconds(value));
}
function copyIntroduction(value: Introduction): Introduction {
  return {
    ...value,
    createdAt: copyDate(value.createdAt),
    updatedAt: copyDate(value.updatedAt),
  };
}
function copySuggestion(value: Suggestion): Suggestion {
  return {
    ...value,
    createdAt: copyDate(value.createdAt),
    updatedAt: copyDate(value.updatedAt),
  };
}
function copyEvent(value: Event): Event {
  return {
    ...value,
    scheduledAt: copyDate(value.scheduledAt),
    createdAt: copyDate(value.createdAt),
    updatedAt: copyDate(value.updatedAt),
  };
}
function copyRsvp(value: Rsvp): Rsvp {
  return {
    ...value,
    createdAt: copyDate(value.createdAt),
    updatedAt: copyDate(value.updatedAt),
  };
}
function toIntroduction(row: IntroductionRow): Introduction {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    ownerUserId: row.owner_user_id,
    displayName: row.display_name,
    interests: row.interests,
    introduction: row.introduction,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
function toSuggestion(row: SuggestionRow): Suggestion {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    ownerUserId: row.owner_user_id,
    title: row.title,
    description: row.description,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
function toEvent(row: EventRow): Event {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    ownerUserId: row.owner_user_id,
    title: row.title,
    description: row.description,
    scheduledAt: new Date(row.scheduled_at),
    timezone: row.timezone,
    capacity: row.capacity,
    status: row.status,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
function toRsvp(row: RsvpRow): Rsvp {
  return {
    eventId: row.event_id,
    guildId: row.guild_id,
    userId: row.user_id,
    response: row.response,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
