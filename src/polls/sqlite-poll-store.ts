import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type {
  PollOptionView,
  PollStatus,
  PollSyncState,
  PollView,
} from './poll-types.js';
import {
  PollReservationConflictError,
  type PollStore,
  type ReservePollInput,
} from './poll-store.js';

interface PollRow {
  id: string;
  guild_id: string;
  conversation_id: string;
  channel_id: string;
  parent_channel_id: string | null;
  message_id: string | null;
  creator_user_id: string;
  question: string;
  status: PollStatus;
  closes_at: number;
  closed_at: number | null;
  sync_state: PollSyncState;
  sync_attempts: number;
  next_sync_at: number | null;
}

interface PollOptionRow {
  option_index: number;
  label: string;
  vote_count: number;
}

export class SQLitePollStore implements PollStore {
  private readonly database: Database.Database;
  private closed = false;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.configure();
    this.migrate();
  }

  async reserve(input: ReservePollInput): Promise<PollView> {
    this.ensureOpen();
    this.validateReserveInput(input);
    const reserve = this.database.transaction((value: ReservePollInput) => {
      this.database
        .prepare(
          `INSERT INTO polls (
            id, guild_id, conversation_id, channel_id, parent_channel_id,
            creator_user_id, question, status, closes_at, created_at,
            updated_at, sync_state, sync_attempts, next_sync_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'creating', ?, ?, ?, 'pending', 0, NULL)`,
        )
        .run(
          value.id,
          value.guildId,
          value.conversationId,
          value.channelId,
          value.parentChannelId ?? null,
          value.creatorUserId,
          value.question,
          value.closesAt.getTime(),
          value.createdAt.getTime(),
          value.createdAt.getTime(),
        );
      const insertOption = this.database.prepare(
        'INSERT INTO poll_options (poll_id, option_index, label, vote_count) VALUES (?, ?, ?, 0)',
      );
      value.options.forEach((label, index) => {
        insertOption.run(value.id, index, label);
      });
      return this.requirePoll(value.id);
    });
    try {
      return reserve(input);
    } catch (error) {
      if (isPollReservationConflict(error)) {
        throw new PollReservationConflictError();
      }
      throw error;
    }
  }

  async activate(pollId: string, messageId: string): Promise<PollView> {
    this.ensureOpen();
    const activate = this.database.transaction(
      (id: string, message: string) => {
        const poll = this.requirePoll(id);
        if (poll.status === 'creating') {
          this.database
            .prepare(
              `UPDATE polls
             SET status = 'active', message_id = ?, sync_state = 'synced',
                 next_sync_at = NULL, updated_at = ?
             WHERE id = ? AND status = 'creating'`,
            )
            .run(message, Date.now(), id);
        }
        return this.requirePoll(id);
      },
    );
    return activate(pollId, messageId);
  }

  async markFailed(pollId: string): Promise<void> {
    this.ensureOpen();
    this.database
      .prepare(
        `UPDATE polls
         SET status = 'failed', next_sync_at = NULL, updated_at = ?
         WHERE id = ? AND status = 'creating'`,
      )
      .run(Date.now(), pollId);
  }

  async recordVote(input: {
    readonly pollId: string;
    readonly voterKey: string;
    readonly optionIndex: number;
    readonly now: Date;
  }): Promise<{
    readonly kind: 'recorded' | 'changed' | 'unchanged';
    readonly poll: PollView;
  }> {
    this.ensureOpen();
    const record = this.database.transaction((value: typeof input) => {
      const poll = this.requirePoll(value.pollId);
      if (
        poll.status !== 'active' ||
        poll.closesAt.getTime() <= value.now.getTime()
      ) {
        throw new Error('This poll is closed.');
      }
      const option = this.database
        .prepare(
          'SELECT 1 FROM poll_options WHERE poll_id = ? AND option_index = ?',
        )
        .get(value.pollId, value.optionIndex);
      if (option === undefined) {
        throw new RangeError('The selected poll option is invalid.');
      }
      const previous = this.database
        .prepare(
          'SELECT option_index FROM poll_votes WHERE poll_id = ? AND voter_key = ?',
        )
        .get(value.pollId, value.voterKey) as
        { option_index: number } | undefined;

      let kind: 'recorded' | 'changed' | 'unchanged';
      if (previous === undefined) {
        this.database
          .prepare(
            `INSERT INTO poll_votes (poll_id, voter_key, option_index, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(
            value.pollId,
            value.voterKey,
            value.optionIndex,
            value.now.getTime(),
            value.now.getTime(),
          );
        this.adjustOptionCount(value.pollId, value.optionIndex, 1);
        kind = 'recorded';
      } else if (previous.option_index === value.optionIndex) {
        kind = 'unchanged';
      } else {
        this.database
          .prepare(
            `UPDATE poll_votes
             SET option_index = ?, updated_at = ?
             WHERE poll_id = ? AND voter_key = ?`,
          )
          .run(
            value.optionIndex,
            value.now.getTime(),
            value.pollId,
            value.voterKey,
          );
        this.adjustOptionCount(value.pollId, previous.option_index, -1);
        this.adjustOptionCount(value.pollId, value.optionIndex, 1);
        kind = 'changed';
      }
      this.database
        .prepare('UPDATE polls SET updated_at = ? WHERE id = ?')
        .run(value.now.getTime(), value.pollId);
      return { kind, poll: this.requirePoll(value.pollId) };
    });
    return record(input);
  }

  async close(pollId: string, now: Date): Promise<PollView> {
    this.ensureOpen();
    return this.closeTransaction(pollId, now);
  }

  async closeDue(now: Date, limit: number): Promise<readonly PollView[]> {
    this.ensureOpen();
    this.validateLimit(limit);
    const closeDue = this.database.transaction((current: Date, max: number) => {
      const due = this.database
        .prepare(
          `SELECT id FROM polls
           WHERE status = 'active' AND closes_at <= ?
           ORDER BY closes_at ASC, id ASC
           LIMIT ?`,
        )
        .all(current.getTime(), max) as { id: string }[];
      return due.map(({ id }) => this.closeInTransaction(id, current));
    });
    return closeDue(now, limit);
  }

  async markPendingSync(pollId: string, nextSyncAt: Date): Promise<void> {
    this.ensureOpen();
    this.database
      .prepare(
        `UPDATE polls
         SET sync_state = 'pending', sync_attempts = sync_attempts + 1,
             next_sync_at = ?, updated_at = ?
         WHERE id = ? AND status NOT IN ('failed', 'orphaned')`,
      )
      .run(nextSyncAt.getTime(), Date.now(), pollId);
  }

  async markSynced(pollId: string): Promise<void> {
    this.ensureOpen();
    this.database
      .prepare(
        `UPDATE polls
         SET sync_state = 'synced', sync_attempts = 0, next_sync_at = NULL,
             updated_at = ?
         WHERE id = ? AND status NOT IN ('failed', 'orphaned')`,
      )
      .run(Date.now(), pollId);
  }

  async markOrphaned(pollId: string): Promise<void> {
    this.ensureOpen();
    const orphan = this.database.transaction((id: string) => {
      const poll = this.requirePoll(id);
      if (poll.status === 'orphaned') {
        return;
      }
      this.database
        .prepare(
          `UPDATE polls
           SET status = 'orphaned', sync_state = 'orphaned', next_sync_at = NULL,
               updated_at = ?
           WHERE id = ?`,
        )
        .run(Date.now(), id);
      this.database.prepare('DELETE FROM poll_votes WHERE poll_id = ?').run(id);
    });
    orphan(pollId);
  }

  async listPendingSync(
    now: Date,
    limit: number,
  ): Promise<readonly PollView[]> {
    this.ensureOpen();
    this.validateLimit(limit);
    const ids = this.database
      .prepare(
        `SELECT id FROM polls
         WHERE sync_state = 'pending' AND next_sync_at IS NOT NULL
           AND next_sync_at <= ? AND status NOT IN ('failed', 'orphaned')
         ORDER BY next_sync_at ASC, id ASC
         LIMIT ?`,
      )
      .all(now.getTime(), limit) as { id: string }[];
    return ids.map(({ id }) => this.requirePoll(id));
  }

  async countCapacityOccupying(): Promise<number> {
    this.ensureOpen();
    const result = this.database
      .prepare(
        "SELECT COUNT(*) AS count FROM polls WHERE status IN ('creating', 'active')",
      )
      .get() as { count: number };
    return result.count;
  }

  async hasActiveByCreatorInConversation(
    creatorUserId: string,
    conversationId: string,
  ): Promise<boolean> {
    this.ensureOpen();
    return (
      this.database
        .prepare(
          `SELECT 1 FROM polls
           WHERE creator_user_id = ? AND conversation_id = ? AND status = 'active'
           LIMIT 1`,
        )
        .get(creatorUserId, conversationId) !== undefined
    );
  }

  async cleanup(cutoff: Date): Promise<number> {
    this.ensureOpen();
    return this.database
      .prepare(
        `DELETE FROM polls
         WHERE status IN ('closed', 'failed', 'orphaned') AND updated_at < ?`,
      )
      .run(cutoff.getTime()).changes;
  }

  async healthCheck(): Promise<boolean> {
    if (this.closed) {
      return false;
    }
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
          `CREATE TABLE IF NOT EXISTS poll_schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at INTEGER NOT NULL
          )`,
        )
        .run();
      const hasInitialSchema = this.database
        .prepare('SELECT 1 FROM poll_schema_migrations WHERE version = 1')
        .get();
      if (hasInitialSchema === undefined) {
        this.database
          .prepare(
            `CREATE TABLE IF NOT EXISTS polls (
            id TEXT PRIMARY KEY,
            guild_id TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            channel_id TEXT NOT NULL,
            parent_channel_id TEXT,
            message_id TEXT,
            creator_user_id TEXT NOT NULL,
            question TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('creating', 'active', 'closed', 'orphaned', 'failed')),
            closes_at INTEGER NOT NULL,
            closed_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            sync_state TEXT NOT NULL CHECK (sync_state IN ('pending', 'synced', 'orphaned')),
            sync_attempts INTEGER NOT NULL DEFAULT 0 CHECK (sync_attempts >= 0),
            next_sync_at INTEGER
            )`,
          )
          .run();
        this.database
          .prepare(
            `CREATE TABLE IF NOT EXISTS poll_options (
            poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
            option_index INTEGER NOT NULL CHECK (option_index BETWEEN 0 AND 4),
            label TEXT NOT NULL,
            vote_count INTEGER NOT NULL DEFAULT 0 CHECK (vote_count >= 0),
            PRIMARY KEY (poll_id, option_index)
            )`,
          )
          .run();
        this.database
          .prepare(
            `CREATE TABLE IF NOT EXISTS poll_votes (
            poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
            voter_key TEXT NOT NULL,
            option_index INTEGER NOT NULL CHECK (option_index BETWEEN 0 AND 4),
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (poll_id, voter_key),
            FOREIGN KEY (poll_id, option_index)
              REFERENCES poll_options(poll_id, option_index)
            )`,
          )
          .run();
        this.database
          .prepare(
            `CREATE INDEX IF NOT EXISTS polls_due_active
           ON polls (status, closes_at, id)`,
          )
          .run();
        this.database
          .prepare(
            `CREATE INDEX IF NOT EXISTS polls_pending_sync
           ON polls (sync_state, next_sync_at, id)`,
          )
          .run();
        this.database
          .prepare(
            `CREATE INDEX IF NOT EXISTS polls_creator_conversation_active
           ON polls (creator_user_id, conversation_id, status)`,
          )
          .run();
        this.database
          .prepare(
            'INSERT INTO poll_schema_migrations (version, applied_at) VALUES (1, ?)',
          )
          .run(Date.now());
      }
      const hasReservationLimit = this.database
        .prepare('SELECT 1 FROM poll_schema_migrations WHERE version = 2')
        .get();
      if (hasReservationLimit === undefined) {
        this.database
          .prepare(
            `CREATE UNIQUE INDEX IF NOT EXISTS polls_creator_conversation_open
             ON polls (creator_user_id, conversation_id)
             WHERE status IN ('creating', 'active')`,
          )
          .run();
        this.database
          .prepare(
            'INSERT INTO poll_schema_migrations (version, applied_at) VALUES (2, ?)',
          )
          .run(Date.now());
      }
    })();
  }

  private closeTransaction(pollId: string, now: Date): PollView {
    const close = this.database.transaction((id: string, current: Date) =>
      this.closeInTransaction(id, current),
    );
    return close(pollId, now);
  }

  private closeInTransaction(pollId: string, now: Date): PollView {
    const poll = this.requirePoll(pollId);
    if (poll.status === 'closed') {
      return poll;
    }
    if (poll.status !== 'active' && poll.status !== 'creating') {
      return poll;
    }
    this.database
      .prepare(
        `UPDATE polls
         SET status = 'closed', closed_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('creating', 'active')`,
      )
      .run(now.getTime(), now.getTime(), pollId);
    this.database
      .prepare('DELETE FROM poll_votes WHERE poll_id = ?')
      .run(pollId);
    return this.requirePoll(pollId);
  }

  private adjustOptionCount(
    pollId: string,
    optionIndex: number,
    delta: number,
  ): void {
    const result = this.database
      .prepare(
        `UPDATE poll_options
         SET vote_count = vote_count + ?
         WHERE poll_id = ? AND option_index = ? AND vote_count + ? >= 0`,
      )
      .run(delta, pollId, optionIndex, delta);
    if (result.changes !== 1) {
      throw new Error('Poll vote aggregate is inconsistent.');
    }
  }

  private getPoll(id: string): PollView | undefined {
    const row = this.database
      .prepare(
        `SELECT id, guild_id, conversation_id, channel_id, parent_channel_id,
                message_id, creator_user_id, question, status, closes_at,
                closed_at, sync_state, sync_attempts, next_sync_at
         FROM polls WHERE id = ?`,
      )
      .get(id) as PollRow | undefined;
    if (row === undefined) {
      return undefined;
    }
    const options = this.database
      .prepare(
        `SELECT option_index, label, vote_count
         FROM poll_options WHERE poll_id = ? ORDER BY option_index ASC`,
      )
      .all(id) as PollOptionRow[];
    return toPollView(row, options);
  }

  private requirePoll(id: string): PollView {
    const poll = this.getPoll(id);
    if (poll === undefined) {
      throw new Error('Poll not found.');
    }
    return poll;
  }

  private validateReserveInput(input: ReservePollInput): void {
    if (input.options.length < 2 || input.options.length > 5) {
      throw new RangeError('A poll must have between 2 and 5 options.');
    }
    if (
      !Number.isFinite(input.closesAt.getTime()) ||
      !Number.isFinite(input.createdAt.getTime())
    ) {
      throw new RangeError('Poll timestamps must be valid dates.');
    }
  }

  private validateLimit(limit: number): void {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError('Poll query limit must be a positive safe integer.');
    }
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error('Poll store is closed.');
    }
  }
}

function isPollReservationConflict(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    'code' in error &&
    (error as { code?: string }).code?.startsWith('SQLITE_CONSTRAINT') ===
      true &&
    error.message.includes('polls.creator_user_id, polls.conversation_id')
  );
}

function toPollView(row: PollRow, options: readonly PollOptionRow[]): PollView {
  return {
    id: row.id,
    guildId: row.guild_id,
    conversationId: row.conversation_id,
    channelId: row.channel_id,
    ...(row.parent_channel_id === null
      ? {}
      : { parentChannelId: row.parent_channel_id }),
    ...(row.message_id === null ? {} : { messageId: row.message_id }),
    creatorUserId: row.creator_user_id,
    question: row.question,
    status: row.status,
    closesAt: new Date(row.closes_at),
    ...(row.closed_at === null ? {} : { closedAt: new Date(row.closed_at) }),
    syncState: row.sync_state,
    syncAttempts: row.sync_attempts,
    ...(row.next_sync_at === null
      ? {}
      : { nextSyncAt: new Date(row.next_sync_at) }),
    options: options.map((option): PollOptionView => ({
      index: option.option_index,
      label: option.label,
      voteCount: option.vote_count,
    })),
  };
}
