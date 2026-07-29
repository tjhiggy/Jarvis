import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import {
  ReminderActiveLimitError,
  ReminderStateConflictError,
  type CreateReminderInput,
  type ReminderFailureCategory,
  type ReminderStore,
} from './reminder-store.js';
import type {
  ReminderStatus,
  ReminderStatusCounts,
  ReminderView,
} from './reminder-types.js';

interface ReminderRow {
  id: string;
  guild_id: string;
  channel_id: string;
  parent_channel_id: string | null;
  owner_user_id: string;
  message: string;
  due_at: number;
  status: ReminderStatus;
  attempt_count: number;
  next_attempt_at: number | null;
  lease_id: string | null;
  claimed_at: number | null;
  created_at: number;
  delivered_at: number | null;
  cancelled_at: number | null;
  failed_at: number | null;
  uncertain_at: number | null;
  failure_category: ReminderFailureCategory | null;
  updated_at: number;
}

const activeStatuses =
  "'pending', 'claimed', 'retry_pending', 'delivery_uncertain'";

export class SQLiteReminderStore implements ReminderStore {
  private readonly database: Database.Database;
  private readonly createTransaction: (
    input: CreateReminderInput,
    activeLimit: number,
  ) => ReminderView;
  private closed = false;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.configure();
    this.migrate();
    this.createTransaction = this.database.transaction(
      (input: CreateReminderInput, activeLimit: number): ReminderView => {
        const activeCount = this.database
          .prepare(
            `
              SELECT COUNT(*) AS count
              FROM reminders
              WHERE guild_id = ?
                AND owner_user_id = ?
                AND status IN (${activeStatuses})
            `,
          )
          .get(input.guildId, input.ownerUserId) as { count: number };
        if (activeCount.count >= activeLimit) {
          throw new ReminderActiveLimitError('Active reminder limit reached.');
        }

        this.database
          .prepare(
            `
              INSERT INTO reminders (
                id, guild_id, channel_id, parent_channel_id, owner_user_id,
                message, due_at, status, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
            `,
          )
          .run(
            input.id,
            input.guildId,
            input.channelId,
            input.parentChannelId ?? null,
            input.ownerUserId,
            input.message,
            input.dueAt.getTime(),
            input.createdAt.getTime(),
            input.createdAt.getTime(),
          );
        return {
          ...input,
          status: 'pending',
          attemptCount: 0,
        };
      },
    ).immediate;
  }

  async create(
    input: CreateReminderInput,
    activeLimit: number,
  ): Promise<ReminderView> {
    this.ensureOpen();
    if (!Number.isSafeInteger(activeLimit) || activeLimit < 1) {
      throw new RangeError(
        'Active reminder limit must be a positive safe integer.',
      );
    }
    return this.createTransaction(
      {
        ...input,
        dueAt: copyFiniteDate(input.dueAt),
        createdAt: copyFiniteDate(input.createdAt),
      },
      activeLimit,
    );
  }

  async listByOwner(
    guildId: string,
    ownerUserId: string,
  ): Promise<readonly ReminderView[]> {
    this.ensureOpen();
    const rows = this.database
      .prepare(
        `
          SELECT * FROM reminders
          WHERE guild_id = ? AND owner_user_id = ?
          ORDER BY due_at ASC, id ASC
        `,
      )
      .all(guildId, ownerUserId) as ReminderRow[];
    return rows.map(toReminderView);
  }

  async cancelOwned(
    guildId: string,
    ownerUserId: string,
    reminderId: string,
    now: Date,
  ): Promise<ReminderView | undefined> {
    this.ensureOpen();
    const nowMilliseconds = finiteDateMilliseconds(now);
    return this.database
      .transaction(() => {
        const row = this.database
          .prepare(
            'SELECT * FROM reminders WHERE id = ? AND guild_id = ? AND owner_user_id = ?',
          )
          .get(reminderId, guildId, ownerUserId) as ReminderRow | undefined;
        if (row === undefined) return undefined;
        if (row.status !== 'cancelled') {
          this.database
            .prepare(
              `
              UPDATE reminders
              SET status = 'cancelled', cancelled_at = ?, updated_at = ?,
                  lease_id = NULL, claimed_at = NULL
              WHERE id = ?
                AND status IN (${activeStatuses})
            `,
            )
            .run(nowMilliseconds, nowMilliseconds, reminderId);
          const cancelled = this.database
            .prepare('SELECT * FROM reminders WHERE id = ?')
            .get(reminderId) as ReminderRow;
          return toReminderView(cancelled);
        }
        return toReminderView(row);
      })
      .immediate();
  }

  async recoverExpiredClaims(leaseCutoff: Date, now: Date): Promise<number> {
    this.ensureOpen();
    const cutoffMilliseconds = finiteDateMilliseconds(leaseCutoff);
    const nowMilliseconds = finiteDateMilliseconds(now);
    return this.database
      .prepare(
        `
          UPDATE reminders
          SET status = 'retry_pending', next_attempt_at = ?, lease_id = NULL,
              claimed_at = NULL, updated_at = ?
          WHERE status = 'claimed' AND claimed_at < ?
        `,
      )
      .run(nowMilliseconds, nowMilliseconds, cutoffMilliseconds).changes;
  }

  async claimDue(
    now: Date,
    leaseId: string,
    limit: number,
  ): Promise<readonly ReminderView[]> {
    this.ensureOpen();
    const nowMilliseconds = finiteDateMilliseconds(now);
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new RangeError('Claim limit must be a non-negative safe integer.');
    }
    if (limit === 0) return [];
    return this.database
      .transaction(() => {
        const ids = this.database
          .prepare(
            `
            SELECT id
            FROM reminders
            WHERE (status = 'pending' AND due_at <= ?)
               OR (status = 'retry_pending' AND next_attempt_at <= ?)
            ORDER BY due_at ASC, id ASC
            LIMIT ?
          `,
          )
          .all(nowMilliseconds, nowMilliseconds, limit) as Array<{
          id: string;
        }>;
        const claim = this.database.prepare(
          `
          UPDATE reminders
          SET status = 'claimed', lease_id = ?, claimed_at = ?, updated_at = ?
          WHERE id = ?
            AND (status = 'pending' OR status = 'retry_pending')
        `,
        );
        const getById = this.database.prepare(
          'SELECT * FROM reminders WHERE id = ?',
        );
        return ids.map(({ id }) => {
          claim.run(leaseId, nowMilliseconds, nowMilliseconds, id);
          return toReminderView(getById.get(id) as ReminderRow);
        });
      })
      .immediate();
  }

  async markDelivered(
    reminderId: string,
    leaseId: string,
    deliveredAt: Date,
  ): Promise<void> {
    this.ensureOpen();
    const deliveredMilliseconds = finiteDateMilliseconds(deliveredAt);
    this.transition(
      `
        UPDATE reminders
        SET status = 'delivered', delivered_at = ?, next_attempt_at = NULL,
            lease_id = NULL, claimed_at = NULL, failure_category = NULL,
            updated_at = ?
        WHERE id = ? AND status = 'claimed' AND lease_id = ?
      `,
      [deliveredMilliseconds, deliveredMilliseconds, reminderId, leaseId],
    );
  }

  async markRetry(
    reminderId: string,
    leaseId: string,
    attemptCount: number,
    nextAttemptAt: Date,
    category: ReminderFailureCategory,
  ): Promise<void> {
    this.ensureOpen();
    const nextAttemptMilliseconds = finiteDateMilliseconds(nextAttemptAt);
    this.transition(
      `
        UPDATE reminders
        SET status = 'retry_pending', attempt_count = ?, next_attempt_at = ?,
            lease_id = NULL, claimed_at = NULL, failure_category = ?, updated_at = ?
        WHERE id = ? AND status = 'claimed' AND lease_id = ?
      `,
      [
        attemptCount,
        nextAttemptMilliseconds,
        category,
        Date.now(),
        reminderId,
        leaseId,
      ],
    );
  }

  async markFailed(
    reminderId: string,
    leaseId: string,
    failedAt: Date,
    category: ReminderFailureCategory,
  ): Promise<void> {
    this.ensureOpen();
    const failedMilliseconds = finiteDateMilliseconds(failedAt);
    this.transition(
      `
        UPDATE reminders
        SET status = 'failed', failed_at = ?, next_attempt_at = NULL,
            lease_id = NULL, claimed_at = NULL, failure_category = ?, updated_at = ?
        WHERE id = ? AND status = 'claimed' AND lease_id = ?
      `,
      [failedMilliseconds, category, failedMilliseconds, reminderId, leaseId],
    );
  }

  async markDeliveryUncertain(
    reminderId: string,
    leaseId: string,
    uncertainAt: Date,
  ): Promise<void> {
    this.ensureOpen();
    const uncertainMilliseconds = finiteDateMilliseconds(uncertainAt);
    this.transition(
      `
        UPDATE reminders
        SET status = 'delivery_uncertain', uncertain_at = ?, next_attempt_at = NULL,
            lease_id = NULL, claimed_at = NULL, updated_at = ?
        WHERE id = ? AND status = 'claimed' AND lease_id = ?
      `,
      [uncertainMilliseconds, uncertainMilliseconds, reminderId, leaseId],
    );
  }

  async cleanup(cutoff: Date, limit: number): Promise<number> {
    this.ensureOpen();
    const cutoffMilliseconds = finiteDateMilliseconds(cutoff);
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new RangeError(
        'Cleanup limit must be a non-negative safe integer.',
      );
    }
    return this.database
      .prepare(
        `
          DELETE FROM reminders
          WHERE id IN (
            SELECT id
            FROM reminders
            WHERE status IN ('delivered', 'cancelled', 'failed')
              AND updated_at < ?
            ORDER BY updated_at ASC, id ASC
            LIMIT ?
          )
        `,
      )
      .run(cutoffMilliseconds, limit).changes;
  }

  async statusCounts(): Promise<ReminderStatusCounts> {
    this.ensureOpen();
    const rows = this.database
      .prepare(
        `
          SELECT status, COUNT(*) AS count
          FROM reminders
          WHERE status IN ('pending', 'retry_pending', 'delivery_uncertain', 'failed')
          GROUP BY status
        `,
      )
      .all() as Array<{ status: ReminderStatus; count: number }>;
    let pending = 0;
    let retryPending = 0;
    let deliveryUncertain = 0;
    let failed = 0;
    for (const row of rows) {
      if (row.status === 'pending') pending = row.count;
      if (row.status === 'retry_pending') retryPending = row.count;
      if (row.status === 'delivery_uncertain') {
        deliveryUncertain = row.count;
      }
      if (row.status === 'failed') failed = row.count;
    }
    return { pending, retryPending, deliveryUncertain, failed };
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
          `
            CREATE TABLE IF NOT EXISTS reminder_schema_migrations (
              version INTEGER PRIMARY KEY,
              applied_at INTEGER NOT NULL
            )
          `,
        )
        .run();
      const applied = this.database
        .prepare(
          'SELECT version FROM reminder_schema_migrations WHERE version = 1',
        )
        .get();
      if (applied !== undefined) return;
      this.database
        .prepare(
          `
            CREATE TABLE reminders (
              id TEXT PRIMARY KEY,
              guild_id TEXT NOT NULL,
              channel_id TEXT NOT NULL,
              parent_channel_id TEXT,
              owner_user_id TEXT NOT NULL,
              message TEXT NOT NULL,
              due_at INTEGER NOT NULL,
              status TEXT NOT NULL CHECK (status IN (
                'pending', 'claimed', 'retry_pending', 'delivery_uncertain',
                'delivered', 'cancelled', 'failed'
              )),
              attempt_count INTEGER NOT NULL DEFAULT 0,
              next_attempt_at INTEGER,
              lease_id TEXT,
              claimed_at INTEGER,
              created_at INTEGER NOT NULL,
              delivered_at INTEGER,
              cancelled_at INTEGER,
              failed_at INTEGER,
              uncertain_at INTEGER,
              failure_category TEXT,
              updated_at INTEGER NOT NULL
            )
          `,
        )
        .run();
      this.database
        .prepare(
          `
            CREATE INDEX reminders_owner_due_id
            ON reminders (guild_id, owner_user_id, due_at, id)
          `,
        )
        .run();
      this.database
        .prepare(
          `
            CREATE INDEX reminders_claim_due_id
            ON reminders (status, due_at, next_attempt_at, id)
          `,
        )
        .run();
      this.database
        .prepare(
          'INSERT INTO reminder_schema_migrations (version, applied_at) VALUES (1, ?)',
        )
        .run(Date.now());
    })();
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error('Reminder store is closed.');
  }

  private transition(sql: string, values: readonly unknown[]): void {
    const result = this.database.prepare(sql).run(...values);
    if (result.changes !== 1) {
      throw new ReminderStateConflictError('Reminder state conflict.');
    }
  }
}

function toReminderView(row: ReminderRow): ReminderView {
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    ...(row.parent_channel_id === null
      ? {}
      : { parentChannelId: row.parent_channel_id }),
    ownerUserId: row.owner_user_id,
    message: row.message,
    dueAt: new Date(row.due_at),
    status: row.status,
    attemptCount: row.attempt_count,
    ...(row.next_attempt_at === null
      ? {}
      : { nextAttemptAt: new Date(row.next_attempt_at) }),
    createdAt: new Date(row.created_at),
    ...(row.delivered_at === null
      ? {}
      : { deliveredAt: new Date(row.delivered_at) }),
    ...(row.cancelled_at === null
      ? {}
      : { cancelledAt: new Date(row.cancelled_at) }),
    ...(row.failed_at === null ? {} : { failedAt: new Date(row.failed_at) }),
  };
}

function copyFiniteDate(value: unknown): Date {
  return new Date(finiteDateMilliseconds(value));
}

function finiteDateMilliseconds(value: unknown): number {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError('Expected a finite Date.');
  }
  return value.getTime();
}
