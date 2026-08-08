import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
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
  message_id: string;
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
  message_id: string;
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
  ends_at: number | null;
  timezone: string;
  capacity: number;
  message_id: string;
  destination_missed: number;
  status: EventStatus;
  created_at: number;
  updated_at: number;
}
interface RsvpRow {
  event_id: string;
  guild_id: string;
  user_id: string;
  response: RsvpResponse;
  attendance: 'confirmed' | 'waitlisted' | 'none';
  reminder_opt_in: number;
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
          `INSERT INTO engagement_introductions (id, guild_id, channel_id, owner_user_id, display_name, interests, introduction, message_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          value.id,
          value.guildId,
          value.channelId,
          value.ownerUserId,
          value.displayName,
          value.interests,
          value.introduction,
          value.messageId,
          value.status,
          milliseconds(value.createdAt),
          milliseconds(value.updatedAt),
        );
    } catch (error) {
      this.handleConflict(error);
    }
    return value;
  }

  async recapSource(guildId: string, start: Date, end: Date) {
    this.ensureOpen();
    const bounds = [guildId, milliseconds(start), milliseconds(end)] as const;
    const count = (table: string) =>
      Number(
        (
          this.database
            .prepare(
              `SELECT count(*) AS count FROM ${table} WHERE guild_id = ? AND created_at >= ? AND created_at < ?`,
            )
            .get(...bounds) as { count: number }
        ).count,
      );
    const participantUserIds = (
      this.database
        .prepare(
          'SELECT DISTINCT user_id FROM engagement_rsvps WHERE guild_id = ? AND updated_at >= ? AND updated_at < ?',
        )
        .all(...bounds) as Array<{ user_id: string }>
    ).map((row) => row.user_id);
    const botActivity = Number(
      (
        this.database
          .prepare(
            "SELECT (SELECT count(*) FROM engagement_introductions WHERE guild_id = ? AND created_at >= ? AND created_at < ? AND message_id != '') + (SELECT count(*) FROM engagement_suggestions WHERE guild_id = ? AND created_at >= ? AND created_at < ? AND message_id != '') + (SELECT count(*) FROM engagement_events WHERE guild_id = ? AND created_at >= ? AND created_at < ? AND message_id != '') AS count",
          )
          .get(...bounds, ...bounds, ...bounds) as { count: number }
      ).count,
    );
    return {
      guildId,
      introductions: count('engagement_introductions'),
      suggestions: count('engagement_suggestions'),
      events: count('engagement_events'),
      participantUserIds,
      botActivity,
    };
  }

  async recapEnabled(guildId: string): Promise<boolean> {
    this.ensureOpen();
    return (
      (
        this.database
          .prepare(
            'SELECT enabled FROM engagement_recap_preferences WHERE guild_id = ?',
          )
          .get(guildId) as { enabled: number } | undefined
      )?.enabled === 1
    );
  }
  async setRecapEnabled(
    guildId: string,
    enabled: boolean,
    updatedAt: Date,
  ): Promise<void> {
    this.ensureOpen();
    this.database
      .prepare(
        'INSERT INTO engagement_recap_preferences (guild_id, enabled, updated_at) VALUES (?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at',
      )
      .run(guildId, enabled ? 1 : 0, milliseconds(updatedAt));
  }

  async claimRecapRun(
    guildId: string,
    key: string,
    now: Date,
  ): Promise<string | undefined> {
    this.ensureOpen();
    const leaseToken = randomUUID();
    const timestamp = milliseconds(now);
    const staleBefore = timestamp - 5 * 60 * 1_000;
    const result = this.database
      .prepare(
        "INSERT INTO engagement_recap_runs (guild_id, run_key, state, claimed_at, lease_token, completed_at) VALUES (?, ?, 'pending', ?, ?, NULL) ON CONFLICT(guild_id, run_key) DO UPDATE SET state = 'pending', claimed_at = excluded.claimed_at, lease_token = excluded.lease_token WHERE engagement_recap_runs.state = 'pending' AND engagement_recap_runs.claimed_at < ?",
      )
      .run(guildId, key, timestamp, leaseToken, staleBefore);
    return result.changes === 1 ? leaseToken : undefined;
  }
  async completeRecapRun(
    guildId: string,
    key: string,
    leaseToken: string,
    now: Date,
  ): Promise<boolean> {
    this.ensureOpen();
    return (
      this.database
        .prepare(
          "UPDATE engagement_recap_runs SET state = 'completed', completed_at = ? WHERE guild_id = ? AND run_key = ? AND state = 'pending' AND lease_token = ?",
        )
        .run(milliseconds(now), guildId, key, leaseToken).changes === 1
    );
  }
  async releaseRecapRun(
    guildId: string,
    key: string,
    leaseToken: string,
    _now: Date,
  ): Promise<boolean> {
    this.ensureOpen();
    return (
      this.database
        .prepare(
          "DELETE FROM engagement_recap_runs WHERE guild_id = ? AND run_key = ? AND state = 'pending' AND lease_token = ?",
        )
        .run(guildId, key, leaseToken).changes === 1
    );
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

  async findActiveIntroductionByOwner(
    guildId: string,
    ownerUserId: string,
  ): Promise<Introduction | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        'SELECT * FROM engagement_introductions WHERE guild_id = ? AND owner_user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(guildId, ownerUserId, 'active') as IntroductionRow | undefined;
    return row === undefined ? undefined : toIntroduction(row);
  }

  async updateIntroductionMessageId(
    guildId: string,
    id: string,
    messageId: string,
  ): Promise<Introduction | undefined> {
    this.ensureOpen();
    this.database
      .prepare(
        'UPDATE engagement_introductions SET message_id = ? WHERE guild_id = ? AND id = ?',
      )
      .run(messageId, guildId, id);
    return this.getIntroduction(guildId, id);
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

  async listExpiredIntroductions(
    cutoff: Date,
    limit: number,
  ): Promise<Introduction[]> {
    this.ensureOpen();
    return (
      this.database
        .prepare(
          "SELECT * FROM engagement_introductions WHERE status = 'cleanup_pending' OR (status = 'active' AND updated_at < ?) ORDER BY updated_at ASC, guild_id ASC, id ASC LIMIT ?",
        )
        .all(milliseconds(cutoff), limit) as IntroductionRow[]
    ).map(toIntroduction);
  }

  async deleteIntroductionRecord(
    guildId: string,
    id: string,
  ): Promise<boolean> {
    this.ensureOpen();
    return (
      this.database
        .prepare(
          'DELETE FROM engagement_introductions WHERE guild_id = ? AND id = ?',
        )
        .run(guildId, id).changes === 1
    );
  }

  async createSuggestion(input: Suggestion): Promise<Suggestion> {
    this.ensureOpen();
    const value = copySuggestion(input);
    validateSuggestion(value);
    this.assertNotOptedOut(value.guildId, value.ownerUserId);
    try {
      this.database
        .prepare(
          `INSERT INTO engagement_suggestions (id, guild_id, channel_id, owner_user_id, title, description, message_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          value.id,
          value.guildId,
          value.channelId,
          value.ownerUserId,
          value.title,
          value.description,
          value.messageId,
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

  async findActiveSuggestionByContent(
    guildId: string,
    title: string,
    description: string,
  ): Promise<Suggestion | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        "SELECT * FROM engagement_suggestions WHERE guild_id = ? AND title = ? AND description = ? AND status != 'archived' ORDER BY created_at DESC LIMIT 1",
      )
      .get(guildId, title, description) as SuggestionRow | undefined;
    return row === undefined ? undefined : toSuggestion(row);
  }

  async updateSuggestionMessageId(
    guildId: string,
    id: string,
    messageId: string,
  ): Promise<Suggestion | undefined> {
    this.ensureOpen();
    this.database
      .prepare(
        'UPDATE engagement_suggestions SET message_id = ? WHERE guild_id = ? AND id = ?',
      )
      .run(messageId, guildId, id);
    return this.getSuggestion(guildId, id);
  }

  async deleteSuggestionRecord(guildId: string, id: string): Promise<boolean> {
    this.ensureOpen();
    return (
      this.database
        .prepare(
          'DELETE FROM engagement_suggestions WHERE guild_id = ? AND id = ?',
        )
        .run(guildId, id).changes === 1
    );
  }

  async claimOpenSuggestionForDeletion(
    guildId: string,
    ownerUserId: string,
    id: string,
    updatedAt: Date,
  ): Promise<Suggestion | undefined> {
    this.ensureOpen();
    const result = this.database
      .prepare(
        "UPDATE engagement_suggestions SET status = 'deletion_pending', updated_at = ? WHERE guild_id = ? AND owner_user_id = ? AND id = ? AND status = 'open'",
      )
      .run(milliseconds(updatedAt), guildId, ownerUserId, id);
    return result.changes === 1 ? this.getSuggestion(guildId, id) : undefined;
  }

  async deletePendingSuggestionRecord(
    guildId: string,
    id: string,
  ): Promise<boolean> {
    this.ensureOpen();
    return (
      this.database
        .prepare(
          "DELETE FROM engagement_suggestions WHERE guild_id = ? AND id = ? AND status = 'deletion_pending'",
        )
        .run(guildId, id).changes === 1
    );
  }

  async restorePendingSuggestion(
    guildId: string,
    id: string,
    updatedAt: Date,
  ): Promise<Suggestion | undefined> {
    this.ensureOpen();
    this.database
      .prepare(
        "UPDATE engagement_suggestions SET status = 'open', updated_at = ? WHERE guild_id = ? AND id = ? AND status = 'deletion_pending'",
      )
      .run(milliseconds(updatedAt), guildId, id);
    return this.getSuggestion(guildId, id);
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

  async transitionSuggestionStatus(
    guildId: string,
    id: string,
    expectedStatus: SuggestionStatus,
    status: SuggestionStatus,
    updatedAt: Date,
  ): Promise<Suggestion | undefined> {
    this.ensureOpen();
    const result = this.database
      .prepare(
        'UPDATE engagement_suggestions SET status = ?, updated_at = ? WHERE guild_id = ? AND id = ? AND status = ?',
      )
      .run(status, milliseconds(updatedAt), guildId, id, expectedStatus);
    return result.changes === 1 ? this.getSuggestion(guildId, id) : undefined;
  }

  async markSuggestionCleanupPending(
    guildId: string,
    id: string,
    messageId: string,
    updatedAt: Date,
  ): Promise<Suggestion | undefined> {
    this.ensureOpen();
    const result = this.database
      .prepare(
        "UPDATE engagement_suggestions SET message_id = ?, status = 'cleanup_pending', updated_at = ? WHERE guild_id = ? AND id = ?",
      )
      .run(messageId, milliseconds(updatedAt), guildId, id);
    return result.changes === 1 ? this.getSuggestion(guildId, id) : undefined;
  }

  async listCleanupPendingSuggestions(limit: number): Promise<Suggestion[]> {
    this.ensureOpen();
    return (
      this.database
        .prepare(
          "SELECT * FROM engagement_suggestions WHERE status = 'cleanup_pending' ORDER BY updated_at ASC, guild_id ASC, id ASC LIMIT ?",
        )
        .all(limit) as SuggestionRow[]
    ).map(toSuggestion);
  }

  async createEvent(input: Event): Promise<Event> {
    this.ensureOpen();
    const value = copyEvent(input);
    validateEvent(value);
    this.assertNotOptedOut(value.guildId, value.ownerUserId);
    try {
      this.database
        .prepare(
          `INSERT INTO engagement_events (id, guild_id, channel_id, owner_user_id, title, description, scheduled_at, ends_at, timezone, capacity, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          value.id,
          value.guildId,
          value.channelId,
          value.ownerUserId,
          value.title,
          value.description,
          milliseconds(value.scheduledAt),
          value.endsAt === undefined ? null : milliseconds(value.endsAt),
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

  async listEvents(
    guildId: string,
    now: Date,
    limit: number,
  ): Promise<Event[]> {
    this.ensureOpen();
    return (
      this.database
        .prepare(
          "SELECT * FROM engagement_events WHERE guild_id = ? AND status = 'scheduled' AND scheduled_at >= ? ORDER BY scheduled_at ASC, id ASC LIMIT ?",
        )
        .all(guildId, milliseconds(now), limit) as EventRow[]
    ).map(toEvent);
  }

  async listRsvps(guildId: string, eventId: string): Promise<Rsvp[]> {
    this.ensureOpen();
    return (
      this.database
        .prepare(
          'SELECT * FROM engagement_rsvps WHERE guild_id = ? AND event_id = ? ORDER BY updated_at ASC, user_id ASC',
        )
        .all(guildId, eventId) as RsvpRow[]
    ).map(toRsvp);
  }

  async updateEventMessageId(
    guildId: string,
    eventId: string,
    messageId: string,
  ): Promise<Event | undefined> {
    this.ensureOpen();
    this.database
      .prepare(
        'UPDATE engagement_events SET message_id = ? WHERE guild_id = ? AND id = ?',
      )
      .run(messageId, guildId, eventId);
    return this.getEvent(guildId, eventId);
  }

  async markEventDestinationMissed(
    guildId: string,
    eventId: string,
    updatedAt: Date,
  ): Promise<void> {
    this.ensureOpen();
    this.database
      .prepare(
        'UPDATE engagement_events SET destination_missed = 1, updated_at = ? WHERE guild_id = ? AND id = ?',
      )
      .run(milliseconds(updatedAt), guildId, eventId);
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
        `INSERT INTO engagement_rsvps (event_id, guild_id, user_id, response, attendance, reminder_opt_in, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(guild_id, event_id, user_id) DO UPDATE SET response = excluded.response, attendance = excluded.attendance, reminder_opt_in = excluded.reminder_opt_in, updated_at = excluded.updated_at`,
      )
      .run(
        value.eventId,
        value.guildId,
        value.userId,
        value.response,
        value.attendance,
        value.reminderOptIn ? 1 : 0,
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

  async respondToEvent(input: Rsvp): Promise<Rsvp> {
    this.ensureOpen();
    const value = copyRsvp(input);
    validateRsvp(value);
    this.assertNotOptedOut(value.guildId, value.userId);
    const transaction = this.database.transaction(() => {
      const event = this.database
        .prepare(
          "SELECT * FROM engagement_events WHERE guild_id = ? AND id = ? AND status = 'scheduled'",
        )
        .get(value.guildId, value.eventId) as EventRow | undefined;
      if (event === undefined) throw new Error('Event not found.');
      const existing = this.database
        .prepare(
          'SELECT * FROM engagement_rsvps WHERE guild_id = ? AND event_id = ? AND user_id = ?',
        )
        .get(value.guildId, value.eventId, value.userId) as RsvpRow | undefined;
      const confirmed = (
        this.database
          .prepare(
            "SELECT COUNT(*) AS count FROM engagement_rsvps WHERE guild_id = ? AND event_id = ? AND attendance = 'confirmed'",
          )
          .get(value.guildId, value.eventId) as { count: number }
      ).count;
      const currentConfirmed = existing?.attendance === 'confirmed' ? 1 : 0;
      const attendance =
        value.response !== 'yes'
          ? 'none'
          : confirmed - currentConfirmed < event.capacity
            ? 'confirmed'
            : 'waitlisted';
      this.database
        .prepare(
          `INSERT INTO engagement_rsvps (event_id, guild_id, user_id, response, attendance, reminder_opt_in, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(guild_id, event_id, user_id) DO UPDATE SET response = excluded.response, attendance = excluded.attendance, reminder_opt_in = excluded.reminder_opt_in, updated_at = excluded.updated_at`,
        )
        .run(
          value.eventId,
          value.guildId,
          value.userId,
          value.response,
          attendance,
          value.reminderOptIn ? 1 : 0,
          milliseconds(value.createdAt),
          milliseconds(value.updatedAt),
        );
      if (currentConfirmed === 1 && attendance !== 'confirmed') {
        const next = this.database
          .prepare(
            "SELECT user_id FROM engagement_rsvps WHERE guild_id = ? AND event_id = ? AND attendance = 'waitlisted' AND response = 'yes' ORDER BY updated_at ASC, user_id ASC LIMIT 1",
          )
          .get(value.guildId, value.eventId) as { user_id: string } | undefined;
        if (next)
          this.database
            .prepare(
              "UPDATE engagement_rsvps SET attendance = 'confirmed', updated_at = ? WHERE guild_id = ? AND event_id = ? AND user_id = ?",
            )
            .run(
              milliseconds(value.updatedAt),
              value.guildId,
              value.eventId,
              next.user_id,
            );
      }
      return this.database
        .prepare(
          'SELECT * FROM engagement_rsvps WHERE guild_id = ? AND event_id = ? AND user_id = ?',
        )
        .get(value.guildId, value.eventId, value.userId) as RsvpRow;
    });
    return toRsvp(transaction());
  }

  async claimDueEventReminders(now: Date, limit: number) {
    this.ensureOpen();
    const claimedAt = milliseconds(now);
    const staleBefore = claimedAt - 5 * 60 * 1_000;
    return this.database.transaction(() => {
      const candidates = this.database
        .prepare(
          "SELECT r.event_id, r.guild_id, r.user_id, e.channel_id, e.title, e.scheduled_at FROM engagement_rsvps r JOIN engagement_events e ON e.guild_id = r.guild_id AND e.id = r.event_id WHERE e.status = 'scheduled' AND r.response = 'yes' AND r.reminder_opt_in = 1 AND r.reminder_state = 'pending' AND e.scheduled_at <= ? AND (r.reminder_claimed_at IS NULL OR r.reminder_claimed_at < ?) ORDER BY e.scheduled_at ASC, r.updated_at ASC, r.user_id ASC LIMIT ?",
        )
        .all(claimedAt, staleBefore, limit) as Array<{
        event_id: string;
        guild_id: string;
        channel_id: string;
        user_id: string;
        title: string;
        scheduled_at: number;
      }>;
      const claim = this.database.prepare(
        "UPDATE engagement_rsvps SET reminder_claimed_at = ?, reminder_lease_token = ? WHERE event_id = ? AND guild_id = ? AND user_id = ? AND reminder_state = 'pending' AND (reminder_claimed_at IS NULL OR reminder_claimed_at < ?)",
      );
      return candidates.flatMap((row) => {
        const leaseToken = randomUUID();
        return claim.run(
          claimedAt,
          leaseToken,
          row.event_id,
          row.guild_id,
          row.user_id,
          staleBefore,
        ).changes === 1
          ? [
              {
                eventId: row.event_id,
                guildId: row.guild_id,
                channelId: row.channel_id,
                userId: row.user_id,
                title: row.title,
                scheduledAt: new Date(row.scheduled_at),
                leaseToken,
              },
            ]
          : [];
      });
    })();
  }
  async markEventReminderDelivered(
    eventId: string,
    guildId: string,
    userId: string,
    leaseToken: string,
    now: Date,
  ): Promise<boolean> {
    return this.markReminder(
      eventId,
      guildId,
      userId,
      leaseToken,
      'delivered',
      now,
    );
  }
  async markEventReminderFailed(
    eventId: string,
    guildId: string,
    userId: string,
    leaseToken: string,
    now: Date,
  ): Promise<boolean> {
    return this.markReminder(
      eventId,
      guildId,
      userId,
      leaseToken,
      'failed',
      now,
    );
  }
  private async markReminder(
    eventId: string,
    guildId: string,
    userId: string,
    leaseToken: string,
    state: string,
    now: Date,
  ): Promise<boolean> {
    this.ensureOpen();
    return (
      this.database
        .prepare(
          "UPDATE engagement_rsvps SET reminder_state = ?, reminder_claimed_at = NULL, reminder_lease_token = NULL, updated_at = ? WHERE event_id = ? AND guild_id = ? AND user_id = ? AND reminder_state = 'pending' AND reminder_lease_token = ?",
        )
        .run(state, milliseconds(now), eventId, guildId, userId, leaseToken)
        .changes === 1
    );
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
        `DELETE FROM engagement_introductions WHERE (guild_id, id) IN (SELECT guild_id, id FROM engagement_introductions WHERE status = 'deleted' AND updated_at < ? ORDER BY updated_at ASC, guild_id ASC, id ASC LIMIT ?)`,
        `DELETE FROM engagement_suggestions WHERE (guild_id, id) IN (SELECT guild_id, id FROM engagement_suggestions WHERE updated_at < ? ORDER BY updated_at ASC, guild_id ASC, id ASC LIMIT ?)`,
        `DELETE FROM engagement_events WHERE (guild_id, id) IN (SELECT guild_id, id FROM engagement_events WHERE status IN ('cancelled', 'completed') AND updated_at < ? ORDER BY updated_at ASC, guild_id ASC, id ASC LIMIT ?)`,
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
      if (!this.hasMigration(3)) {
        if (!this.hasIntroductionMessageId()) {
          this.database.exec(
            "ALTER TABLE engagement_introductions ADD COLUMN message_id TEXT NOT NULL DEFAULT '';",
          );
        }
        this.recordMigration(3);
      }
      if (!this.hasMigration(5)) {
        if (!this.hasCleanupPendingIntroductionStatus()) {
          this.upgradeIntroductionStatusSchema();
        }
        this.recordMigration(5);
      }
      if (!this.hasMigration(4)) {
        this.cancelDuplicateActiveIntroductions();
        this.recordMigration(4);
      }
      if (!this.hasMigration(6)) {
        if (
          this.hasTable('engagement_suggestions') &&
          !this.hasSuggestionMessageId()
        ) {
          this.database.exec(
            "ALTER TABLE engagement_suggestions ADD COLUMN message_id TEXT NOT NULL DEFAULT '';",
          );
        }
        if (this.hasTable('engagement_suggestions'))
          this.archiveDuplicateActiveSuggestions();
        this.recordMigration(6);
      }
      if (!this.hasMigration(7)) {
        if (
          this.hasTable('engagement_suggestions') &&
          !this.hasSuggestionDeletionPendingStatus()
        )
          this.upgradeSuggestionStatusSchema();
        this.recordMigration(7);
      }
      if (!this.hasMigration(8)) {
        if (
          this.hasTable('engagement_suggestions') &&
          !this.hasSuggestionCleanupPendingStatus()
        )
          this.upgradeSuggestionStatusSchema();
        this.recordMigration(8);
      }
      if (!this.hasMigration(9)) {
        if (
          this.hasTable('engagement_events') &&
          !this.hasColumn('engagement_events', 'ends_at')
        )
          this.database.exec(
            'ALTER TABLE engagement_events ADD COLUMN ends_at INTEGER',
          );
        if (
          this.hasTable('engagement_events') &&
          !this.hasColumn('engagement_events', 'message_id')
        )
          this.database.exec(
            "ALTER TABLE engagement_events ADD COLUMN message_id TEXT NOT NULL DEFAULT ''",
          );
        if (
          this.hasTable('engagement_events') &&
          !this.hasColumn('engagement_events', 'destination_missed')
        )
          this.database.exec(
            'ALTER TABLE engagement_events ADD COLUMN destination_missed INTEGER NOT NULL DEFAULT 0',
          );
        if (
          this.hasTable('engagement_rsvps') &&
          !this.hasColumn('engagement_rsvps', 'attendance')
        )
          this.database.exec(
            "ALTER TABLE engagement_rsvps ADD COLUMN attendance TEXT NOT NULL DEFAULT 'none'",
          );
        if (
          this.hasTable('engagement_rsvps') &&
          !this.hasColumn('engagement_rsvps', 'reminder_opt_in')
        )
          this.database.exec(
            'ALTER TABLE engagement_rsvps ADD COLUMN reminder_opt_in INTEGER NOT NULL DEFAULT 0',
          );
        if (
          this.hasTable('engagement_rsvps') &&
          !this.hasColumn('engagement_rsvps', 'reminder_state')
        )
          this.database.exec(
            "ALTER TABLE engagement_rsvps ADD COLUMN reminder_state TEXT NOT NULL DEFAULT 'pending'",
          );
        if (this.hasTable('engagement_rsvps'))
          this.database.exec(
            "UPDATE engagement_rsvps SET attendance = CASE WHEN response = 'yes' THEN 'confirmed' ELSE 'none' END",
          );
        this.recordMigration(9);
      }
      if (!this.hasMigration(10)) {
        if (
          this.hasTable('engagement_rsvps') &&
          !this.hasColumn('engagement_rsvps', 'reminder_claimed_at')
        )
          this.database.exec(
            'ALTER TABLE engagement_rsvps ADD COLUMN reminder_claimed_at INTEGER',
          );
        this.recordMigration(10);
      }
      if (!this.hasMigration(11)) {
        if (
          this.hasTable('engagement_rsvps') &&
          !this.hasColumn('engagement_rsvps', 'reminder_lease_token')
        )
          this.database.exec(
            'ALTER TABLE engagement_rsvps ADD COLUMN reminder_lease_token TEXT',
          );
        this.recordMigration(11);
      }
      if (!this.hasMigration(12)) {
        this.database.exec(
          'CREATE TABLE IF NOT EXISTS engagement_recap_preferences (guild_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)), updated_at INTEGER NOT NULL)',
        );
        this.recordMigration(12);
      }
      if (!this.hasMigration(13)) {
        this.database.exec(
          "CREATE TABLE IF NOT EXISTS engagement_recap_runs (guild_id TEXT NOT NULL, run_key TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('pending', 'completed')), claimed_at INTEGER NOT NULL, lease_token TEXT, completed_at INTEGER, PRIMARY KEY (guild_id, run_key))",
        );
        this.recordMigration(13);
      }
      this.database.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS engagement_active_introduction_owner ON engagement_introductions (guild_id, owner_user_id) WHERE status = 'active';",
      );
      if (this.hasTable('engagement_suggestions')) {
        this.database.exec(
          "CREATE UNIQUE INDEX IF NOT EXISTS engagement_active_suggestion_content ON engagement_suggestions (guild_id, title, description) WHERE status != 'archived';",
        );
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

  private hasTable(name: string): boolean {
    return (
      this.database
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        )
        .get(name) !== undefined
    );
  }
  private hasColumn(table: string, column: string): boolean {
    return (
      this.database.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
      }>
    ).some((value) => value.name === column);
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

  private hasIntroductionMessageId(): boolean {
    return (
      this.database
        .prepare('PRAGMA table_info(engagement_introductions)')
        .all() as Array<{ name: string }>
    ).some((column) => column.name === 'message_id');
  }

  private hasSuggestionMessageId(): boolean {
    return (
      this.database
        .prepare('PRAGMA table_info(engagement_suggestions)')
        .all() as Array<{ name: string }>
    ).some((column) => column.name === 'message_id');
  }

  private hasSuggestionDeletionPendingStatus(): boolean {
    const row = this.database
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'engagement_suggestions'",
      )
      .get() as { sql?: string } | undefined;
    return row?.sql?.includes('deletion_pending') === true;
  }

  private hasSuggestionCleanupPendingStatus(): boolean {
    const row = this.database
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'engagement_suggestions'",
      )
      .get() as { sql?: string } | undefined;
    return row?.sql?.includes('cleanup_pending') === true;
  }

  private upgradeSuggestionStatusSchema(): void {
    this.database.exec(`
      DROP INDEX IF EXISTS engagement_active_suggestion_content;
      DROP INDEX IF EXISTS engagement_suggestions_status_retention;
      ALTER TABLE engagement_suggestions RENAME TO engagement_suggestions_status_legacy;
      CREATE TABLE engagement_suggestions (id TEXT NOT NULL, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, message_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'deferred', 'resolved', 'archived', 'deletion_pending', 'cleanup_pending')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (guild_id, id));
      INSERT INTO engagement_suggestions SELECT * FROM engagement_suggestions_status_legacy;
      DROP TABLE engagement_suggestions_status_legacy;
      CREATE INDEX engagement_suggestions_status_retention ON engagement_suggestions (status, updated_at, id);
    `);
  }

  private hasCleanupPendingIntroductionStatus(): boolean {
    const row = this.database
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'engagement_introductions'",
      )
      .get() as { sql?: string } | undefined;
    return row?.sql?.includes('cleanup_pending') === true;
  }

  private upgradeIntroductionStatusSchema(): void {
    this.database.exec(`
      DROP INDEX IF EXISTS engagement_active_introduction_owner;
      DROP INDEX IF EXISTS engagement_introductions_status_retention;
      ALTER TABLE engagement_introductions RENAME TO engagement_introductions_status_legacy;
      CREATE TABLE engagement_introductions (id TEXT NOT NULL, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, display_name TEXT NOT NULL, interests TEXT NOT NULL, introduction TEXT NOT NULL, message_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK (status IN ('active', 'deleted', 'cleanup_pending')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (guild_id, id));
      INSERT INTO engagement_introductions SELECT * FROM engagement_introductions_status_legacy;
      DROP TABLE engagement_introductions_status_legacy;
      CREATE INDEX engagement_introductions_status_retention ON engagement_introductions (status, updated_at, id);
    `);
  }

  private cancelDuplicateActiveIntroductions(): void {
    const rows = this.database
      .prepare(
        "SELECT guild_id, owner_user_id, id FROM engagement_introductions WHERE status = 'active' ORDER BY guild_id ASC, owner_user_id ASC, created_at DESC, id ASC",
      )
      .all() as Array<{ guild_id: string; owner_user_id: string; id: string }>;
    const retained = new Set<string>();
    const cancel = this.database.prepare(
      "UPDATE engagement_introductions SET status = 'cleanup_pending' WHERE guild_id = ? AND owner_user_id = ? AND id = ?",
    );
    for (const row of rows) {
      const key = `${row.guild_id}:${row.owner_user_id}`;
      if (retained.has(key))
        cancel.run(row.guild_id, row.owner_user_id, row.id);
      else retained.add(key);
    }
  }

  private archiveDuplicateActiveSuggestions(): void {
    const rows = this.database
      .prepare(
        "SELECT guild_id, title, description, id FROM engagement_suggestions WHERE status != 'archived' ORDER BY guild_id ASC, title ASC, description ASC, created_at DESC, id ASC",
      )
      .all() as Array<{
      guild_id: string;
      title: string;
      description: string;
      id: string;
    }>;
    const retained = new Set<string>();
    const archive = this.database.prepare(
      "UPDATE engagement_suggestions SET status = 'archived' WHERE guild_id = ? AND id = ?",
    );
    for (const row of rows) {
      const key = `${row.guild_id}:${row.title}:${row.description}`;
      if (retained.has(key)) archive.run(row.guild_id, row.id);
      else retained.add(key);
    }
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
      INSERT INTO engagement_introductions (id, guild_id, channel_id, owner_user_id, display_name, interests, introduction, status, created_at, updated_at) SELECT id, guild_id, channel_id, owner_user_id, display_name, interests, introduction, status, created_at, updated_at FROM engagement_introductions_legacy;
      INSERT INTO engagement_suggestions (id, guild_id, channel_id, owner_user_id, title, description, message_id, status, created_at, updated_at) SELECT id, guild_id, channel_id, owner_user_id, title, description, '', status, created_at, updated_at FROM engagement_suggestions_legacy;
      INSERT INTO engagement_events (id, guild_id, channel_id, owner_user_id, title, description, scheduled_at, timezone, capacity, status, created_at, updated_at) SELECT id, guild_id, channel_id, owner_user_id, title, description, scheduled_at, timezone, capacity, status, created_at, updated_at FROM engagement_events_legacy;
      INSERT INTO engagement_rsvps (event_id, guild_id, user_id, response, attendance, reminder_opt_in, reminder_state, reminder_claimed_at, reminder_lease_token, created_at, updated_at) SELECT event_id, guild_id, user_id, response, CASE WHEN response = 'yes' THEN 'confirmed' ELSE 'none' END, 0, 'pending', NULL, NULL, created_at, updated_at FROM engagement_rsvps_legacy;
      DROP TABLE engagement_rsvps_legacy;
      DROP TABLE engagement_introductions_legacy;
      DROP TABLE engagement_suggestions_legacy;
      DROP TABLE engagement_events_legacy;
    `);
  }

  private createSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS engagement_introductions (id TEXT NOT NULL, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, display_name TEXT NOT NULL, interests TEXT NOT NULL, introduction TEXT NOT NULL, message_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK (status IN ('active', 'deleted', 'cleanup_pending')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (guild_id, id));
      CREATE TABLE IF NOT EXISTS engagement_suggestions (id TEXT NOT NULL, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, message_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'deferred', 'resolved', 'archived', 'deletion_pending', 'cleanup_pending')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (guild_id, id));
      CREATE TABLE IF NOT EXISTS engagement_events (id TEXT NOT NULL, guild_id TEXT NOT NULL, channel_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, scheduled_at INTEGER NOT NULL, ends_at INTEGER, timezone TEXT NOT NULL, capacity INTEGER NOT NULL CHECK (capacity > 0), message_id TEXT NOT NULL DEFAULT '', destination_missed INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL CHECK (status IN ('scheduled', 'cancelled', 'completed')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (guild_id, id));
      CREATE TABLE IF NOT EXISTS engagement_rsvps (event_id TEXT NOT NULL, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, response TEXT NOT NULL CHECK (response IN ('yes', 'maybe', 'no')), attendance TEXT NOT NULL DEFAULT 'none' CHECK (attendance IN ('confirmed', 'waitlisted', 'none')), reminder_opt_in INTEGER NOT NULL DEFAULT 0, reminder_state TEXT NOT NULL DEFAULT 'pending' CHECK (reminder_state IN ('pending', 'delivered', 'failed')), reminder_claimed_at INTEGER, reminder_lease_token TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (guild_id, event_id, user_id), FOREIGN KEY (guild_id, event_id) REFERENCES engagement_events(guild_id, id) ON DELETE CASCADE);
      CREATE TABLE IF NOT EXISTS engagement_opt_outs (guild_id TEXT NOT NULL, user_id TEXT NOT NULL, opted_out_at INTEGER NOT NULL, PRIMARY KEY (guild_id, user_id));
      CREATE TABLE IF NOT EXISTS engagement_idempotency_keys (guild_id TEXT NOT NULL, scope TEXT NOT NULL CHECK (scope IN ('interaction', 'scheduled-job')), key TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (guild_id, scope, key));
      CREATE TABLE IF NOT EXISTS engagement_recap_preferences (guild_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)), updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS engagement_recap_runs (guild_id TEXT NOT NULL, run_key TEXT NOT NULL, state TEXT NOT NULL CHECK (state IN ('pending', 'completed')), claimed_at INTEGER NOT NULL, lease_token TEXT, completed_at INTEGER, PRIMARY KEY (guild_id, run_key));
      CREATE INDEX IF NOT EXISTS engagement_introductions_status_retention ON engagement_introductions (status, updated_at, id);
      CREATE UNIQUE INDEX IF NOT EXISTS engagement_active_introduction_owner ON engagement_introductions (guild_id, owner_user_id) WHERE status = 'active';
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
    messageId: value.messageId ?? '',
    createdAt: copyDate(value.createdAt),
    updatedAt: copyDate(value.updatedAt),
  };
}
function copySuggestion(value: Suggestion): Suggestion {
  return {
    ...value,
    messageId: value.messageId ?? '',
    createdAt: copyDate(value.createdAt),
    updatedAt: copyDate(value.updatedAt),
  };
}
function copyEvent(value: Event): Event {
  return {
    ...value,
    scheduledAt: copyDate(value.scheduledAt),
    ...(value.endsAt === undefined ? {} : { endsAt: copyDate(value.endsAt) }),
    createdAt: copyDate(value.createdAt),
    updatedAt: copyDate(value.updatedAt),
  };
}
function copyRsvp(value: Rsvp): Rsvp {
  return {
    ...value,
    attendance: value.attendance ?? 'none',
    reminderOptIn: value.reminderOptIn ?? false,
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
    messageId: row.message_id,
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
    messageId: row.message_id,
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
    ...(row.ends_at === null ? {} : { endsAt: new Date(row.ends_at) }),
    timezone: row.timezone,
    capacity: row.capacity,
    ...(row.message_id === '' ? {} : { messageId: row.message_id }),
    destinationMissed: row.destination_missed === 1,
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
    attendance: row.attendance,
    reminderOptIn: row.reminder_opt_in === 1,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}
