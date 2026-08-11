import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { BroadcastCategory } from './broadcast-policy.js';
import type {
  BroadcastDeliveryErrorCategory,
  BroadcastDeliveryHealth,
  BroadcastMemberPreference,
  BroadcastPolicy,
  BroadcastStore,
} from './broadcast-store.js';

interface PolicyRow {
  server_id: string;
  category: BroadcastCategory;
  state: BroadcastPolicy['state'];
  channel_id: string;
  timezone: string;
  quiet_start_minute: number | null;
  quiet_end_minute: number | null;
  minimum_interval_seconds: number;
  digest_mode: number;
  updated_at: number;
  updated_by_user_id: string | null;
}

interface PreferenceRow {
  server_id: string;
  user_id: string;
  category: BroadcastCategory;
  enabled: number;
  updated_at: number;
}

interface DeliveryRow {
  status: 'pending' | 'claimed' | 'completed';
  claimed_at: number | null;
  completed_at: number | null;
  error_category: BroadcastDeliveryErrorCategory | null;
}

const leaseDurationMilliseconds = 5 * 60 * 1000;
const categories = [
  'rss',
  'proactive',
  'recap',
  'event_reminder',
  'birthday',
  'trivia',
];
const states = ['enabled', 'paused', 'disabled'];
const errorCategories = ['network', 'permission', 'rate_limit', 'service'];

export class SqliteBroadcastStore implements BroadcastStore {
  private readonly database: Database.Database;
  private closed = false;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.database = new Database(databasePath);
    this.configure();
    this.migrate();
  }

  async getPolicy(
    serverId: string,
    category: BroadcastCategory,
  ): Promise<BroadcastPolicy | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        'SELECT * FROM broadcast_policies WHERE server_id = ? AND category = ?',
      )
      .get(serverId, category) as PolicyRow | undefined;
    return row === undefined ? undefined : toPolicy(row);
  }

  async setPolicy(policy: BroadcastPolicy): Promise<void> {
    this.ensureOpen();
    validatePolicy(policy);
    this.database
      .prepare(
        `
          INSERT INTO broadcast_policies (
            server_id, category, state, channel_id, timezone,
            quiet_start_minute, quiet_end_minute, minimum_interval_seconds,
            digest_mode, updated_at, updated_by_user_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(server_id, category) DO UPDATE SET
            state = excluded.state,
            channel_id = excluded.channel_id,
            timezone = excluded.timezone,
            quiet_start_minute = excluded.quiet_start_minute,
            quiet_end_minute = excluded.quiet_end_minute,
            minimum_interval_seconds = excluded.minimum_interval_seconds,
            digest_mode = excluded.digest_mode,
            updated_at = excluded.updated_at,
            updated_by_user_id = excluded.updated_by_user_id
        `,
      )
      .run(
        policy.serverId,
        policy.category,
        policy.state,
        policy.channelId,
        policy.timezone,
        policy.quietStartMinute ?? null,
        policy.quietEndMinute ?? null,
        policy.minimumIntervalSeconds,
        policy.digestMode ? 1 : 0,
        finiteDateMilliseconds(policy.updatedAt),
        policy.updatedByUserId ?? null,
      );
  }

  async getMemberPreference(
    serverId: string,
    userId: string,
    category: BroadcastCategory,
  ): Promise<BroadcastMemberPreference | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        `
          SELECT * FROM member_notification_preferences
          WHERE server_id = ? AND user_id = ? AND category = ?
        `,
      )
      .get(serverId, userId, category) as PreferenceRow | undefined;
    return row === undefined ? undefined : toPreference(row);
  }

  async setMemberPreference(
    preference: BroadcastMemberPreference,
  ): Promise<void> {
    this.ensureOpen();
    validatePreference(preference);
    this.database
      .prepare(
        `
          INSERT INTO member_notification_preferences (
            server_id, user_id, category, enabled, updated_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(server_id, user_id, category) DO UPDATE SET
            enabled = excluded.enabled,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        preference.serverId,
        preference.userId,
        preference.category,
        preference.enabled ? 1 : 0,
        finiteDateMilliseconds(preference.updatedAt),
      );
  }

  async claimDelivery(
    serverId: string,
    category: BroadcastCategory,
    deliveryKey: string,
    now: Date,
  ): Promise<string | undefined> {
    this.ensureOpen();
    const nowMilliseconds = finiteDateMilliseconds(now);
    const leaseCutoff = nowMilliseconds - leaseDurationMilliseconds;
    return this.database
      .transaction(() => {
        const row = this.database
          .prepare(
            `
              SELECT status, claimed_at
              FROM broadcast_delivery_runs
              WHERE server_id = ? AND category = ? AND delivery_key = ?
            `,
          )
          .get(serverId, category, deliveryKey) as
          Pick<DeliveryRow, 'status' | 'claimed_at'> | undefined;
        if (row?.status === 'completed') return undefined;
        if (
          row?.status === 'claimed' &&
          row.claimed_at !== null &&
          row.claimed_at > leaseCutoff
        ) {
          return undefined;
        }

        const leaseToken = randomUUID();
        if (row === undefined) {
          this.database
            .prepare(
              `
                INSERT INTO broadcast_delivery_runs (
                  server_id, category, delivery_key, status, lease_token,
                  claimed_at, completed_at, error_category
                ) VALUES (?, ?, ?, 'claimed', ?, ?, NULL, NULL)
              `,
            )
            .run(serverId, category, deliveryKey, leaseToken, nowMilliseconds);
        } else {
          this.database
            .prepare(
              `
                UPDATE broadcast_delivery_runs
                SET status = 'claimed', lease_token = ?, claimed_at = ?,
                    completed_at = NULL, error_category = NULL
                WHERE server_id = ? AND category = ? AND delivery_key = ?
              `,
            )
            .run(leaseToken, nowMilliseconds, serverId, category, deliveryKey);
        }
        return leaseToken;
      })
      .immediate();
  }

  async completeDelivery(
    serverId: string,
    category: BroadcastCategory,
    deliveryKey: string,
    leaseToken: string,
    now: Date,
  ): Promise<boolean> {
    this.ensureOpen();
    const completedAt = finiteDateMilliseconds(now);
    const leaseCutoff = completedAt - leaseDurationMilliseconds;
    return (
      this.database
        .prepare(
          `
            UPDATE broadcast_delivery_runs
            SET status = 'completed', lease_token = NULL, completed_at = ?,
                error_category = NULL
            WHERE server_id = ? AND category = ? AND delivery_key = ?
              AND status = 'claimed' AND lease_token = ? AND claimed_at > ?
          `,
        )
        .run(
          completedAt,
          serverId,
          category,
          deliveryKey,
          leaseToken,
          leaseCutoff,
        ).changes === 1
    );
  }

  async releaseDelivery(
    serverId: string,
    category: BroadcastCategory,
    deliveryKey: string,
    leaseToken: string,
    now: Date,
    errorCategory?: BroadcastDeliveryErrorCategory,
  ): Promise<boolean> {
    this.ensureOpen();
    const releaseAt = finiteDateMilliseconds(now);
    const leaseCutoff = releaseAt - leaseDurationMilliseconds;
    if (
      errorCategory !== undefined &&
      !errorCategories.includes(errorCategory)
    ) {
      throw new RangeError('Unsupported broadcast delivery error category.');
    }
    return (
      this.database
        .prepare(
          `
            UPDATE broadcast_delivery_runs
            SET status = 'pending', lease_token = NULL, error_category = ?
            WHERE server_id = ? AND category = ? AND delivery_key = ?
              AND status = 'claimed' AND lease_token = ? AND claimed_at > ?
          `,
        )
        .run(
          errorCategory ?? null,
          serverId,
          category,
          deliveryKey,
          leaseToken,
          leaseCutoff,
        ).changes === 1
    );
  }

  async deliveryHealth(
    serverId: string,
    category: BroadcastCategory,
    deliveryKey: string,
  ): Promise<BroadcastDeliveryHealth | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        `
          SELECT status, claimed_at, completed_at, error_category
          FROM broadcast_delivery_runs
          WHERE server_id = ? AND category = ? AND delivery_key = ?
        `,
      )
      .get(serverId, category, deliveryKey) as DeliveryRow | undefined;
    return row === undefined ? undefined : toDeliveryHealth(row);
  }

  async latestDeliveryHealth(
    serverId: string,
    category: BroadcastCategory,
  ): Promise<BroadcastDeliveryHealth | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        `SELECT status, claimed_at, completed_at, error_category
        FROM broadcast_delivery_runs
        WHERE server_id = ? AND category = ?
        ORDER BY COALESCE(completed_at, claimed_at) DESC, delivery_key DESC
        LIMIT 1`,
      )
      .get(serverId, category) as DeliveryRow | undefined;
    return row === undefined ? undefined : toDeliveryHealth(row);
  }

  async getLatestCompletedAt(
    serverId: string,
    category: BroadcastCategory,
  ): Promise<Date | undefined> {
    this.ensureOpen();
    const row = this.database
      .prepare(
        `
          SELECT completed_at
          FROM broadcast_delivery_runs
          WHERE server_id = ? AND category = ? AND status = 'completed'
          ORDER BY completed_at DESC, delivery_key ASC
          LIMIT 1
        `,
      )
      .get(serverId, category) as { completed_at: number } | undefined;
    return row === undefined ? undefined : new Date(row.completed_at);
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
          DELETE FROM broadcast_delivery_runs
          WHERE rowid IN (
            SELECT rowid
            FROM broadcast_delivery_runs
            WHERE status = 'completed' AND completed_at < ?
            ORDER BY completed_at ASC, server_id ASC, category ASC, delivery_key ASC
            LIMIT ?
          )
        `,
      )
      .run(cutoffMilliseconds, limit).changes;
  }

  async close(): Promise<void> {
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
            CREATE TABLE IF NOT EXISTS broadcast_schema_migrations (
              version INTEGER PRIMARY KEY,
              applied_at INTEGER NOT NULL
            )
          `,
        )
        .run();
      const applied = this.database
        .prepare(
          'SELECT version FROM broadcast_schema_migrations WHERE version = 1',
        )
        .get();
      if (applied === undefined) {
        this.database
          .prepare(
            `
            CREATE TABLE broadcast_policies (
              server_id TEXT NOT NULL,
              category TEXT NOT NULL CHECK (category IN (
                'rss', 'proactive', 'recap', 'event_reminder', 'birthday'
              )),
              state TEXT NOT NULL CHECK (state IN ('enabled', 'paused', 'disabled')),
              channel_id TEXT NOT NULL,
              timezone TEXT NOT NULL,
              quiet_start_minute INTEGER,
              quiet_end_minute INTEGER,
              minimum_interval_seconds INTEGER NOT NULL,
              digest_mode INTEGER NOT NULL CHECK (digest_mode IN (0, 1)),
              updated_at INTEGER NOT NULL,
              updated_by_user_id TEXT,
              PRIMARY KEY (server_id, category),
              CHECK (
                (quiet_start_minute IS NULL AND quiet_end_minute IS NULL)
                OR (
                  quiet_start_minute BETWEEN 0 AND 1439
                  AND quiet_end_minute BETWEEN 0 AND 1439
                )
              ),
              CHECK (minimum_interval_seconds >= 0)
            )
          `,
          )
          .run();
        this.database
          .prepare(
            `
            CREATE TABLE broadcast_delivery_runs (
              server_id TEXT NOT NULL,
              category TEXT NOT NULL CHECK (category IN (
                'rss', 'proactive', 'recap', 'event_reminder', 'birthday'
              )),
              delivery_key TEXT NOT NULL,
              status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'completed')),
              lease_token TEXT,
              claimed_at INTEGER,
              completed_at INTEGER,
              error_category TEXT CHECK (error_category IN (
                'network', 'permission', 'rate_limit', 'service'
              ) OR error_category IS NULL),
              PRIMARY KEY (server_id, category, delivery_key)
            )
          `,
          )
          .run();
        this.database
          .prepare(
            `
            CREATE TABLE member_notification_preferences (
              server_id TEXT NOT NULL,
              user_id TEXT NOT NULL,
              category TEXT NOT NULL CHECK (category IN (
                'rss', 'proactive', 'recap', 'event_reminder', 'birthday'
              )),
              enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
              updated_at INTEGER NOT NULL,
              PRIMARY KEY (server_id, user_id, category)
            )
          `,
          )
          .run();
        this.database
          .prepare(
            'INSERT INTO broadcast_schema_migrations (version, applied_at) VALUES (1, ?)',
          )
          .run(Date.now());
      }

      const triviaCategoryMigration = this.database
        .prepare(
          'SELECT version FROM broadcast_schema_migrations WHERE version = 2',
        )
        .get();
      if (triviaCategoryMigration !== undefined) return;

      this.database.exec(`
        ALTER TABLE broadcast_policies RENAME TO broadcast_policies_v1;
        ALTER TABLE broadcast_delivery_runs RENAME TO broadcast_delivery_runs_v1;
        ALTER TABLE member_notification_preferences RENAME TO member_notification_preferences_v1;
        CREATE TABLE broadcast_policies (
          server_id TEXT NOT NULL,
          category TEXT NOT NULL CHECK (category IN (
            'rss', 'proactive', 'recap', 'event_reminder', 'birthday', 'trivia'
          )),
          state TEXT NOT NULL CHECK (state IN ('enabled', 'paused', 'disabled')),
          channel_id TEXT NOT NULL,
          timezone TEXT NOT NULL,
          quiet_start_minute INTEGER,
          quiet_end_minute INTEGER,
          minimum_interval_seconds INTEGER NOT NULL,
          digest_mode INTEGER NOT NULL CHECK (digest_mode IN (0, 1)),
          updated_at INTEGER NOT NULL,
          updated_by_user_id TEXT,
          PRIMARY KEY (server_id, category),
          CHECK (
            (quiet_start_minute IS NULL AND quiet_end_minute IS NULL)
            OR (
              quiet_start_minute BETWEEN 0 AND 1439
              AND quiet_end_minute BETWEEN 0 AND 1439
            )
          ),
          CHECK (minimum_interval_seconds >= 0)
        );
        INSERT INTO broadcast_policies (
          server_id, category, state, channel_id, timezone,
          quiet_start_minute, quiet_end_minute, minimum_interval_seconds,
          digest_mode, updated_at, updated_by_user_id
        ) SELECT
          server_id, category, state, channel_id, timezone,
          quiet_start_minute, quiet_end_minute, minimum_interval_seconds,
          digest_mode, updated_at, updated_by_user_id
        FROM broadcast_policies_v1;
        DROP TABLE broadcast_policies_v1;

        CREATE TABLE broadcast_delivery_runs (
          server_id TEXT NOT NULL,
          category TEXT NOT NULL CHECK (category IN (
            'rss', 'proactive', 'recap', 'event_reminder', 'birthday', 'trivia'
          )),
          delivery_key TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'completed')),
          lease_token TEXT,
          claimed_at INTEGER,
          completed_at INTEGER,
          error_category TEXT CHECK (error_category IN (
            'network', 'permission', 'rate_limit', 'service'
          ) OR error_category IS NULL),
          PRIMARY KEY (server_id, category, delivery_key)
        );
        INSERT INTO broadcast_delivery_runs (
          server_id, category, delivery_key, status, lease_token, claimed_at,
          completed_at, error_category
        ) SELECT
          server_id, category, delivery_key, status, lease_token, claimed_at,
          completed_at, error_category
        FROM broadcast_delivery_runs_v1;
        DROP TABLE broadcast_delivery_runs_v1;

        CREATE TABLE member_notification_preferences (
          server_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          category TEXT NOT NULL CHECK (category IN (
            'rss', 'proactive', 'recap', 'event_reminder', 'birthday', 'trivia'
          )),
          enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (server_id, user_id, category)
        );
        INSERT INTO member_notification_preferences (
          server_id, user_id, category, enabled, updated_at
        ) SELECT
          server_id, user_id, category, enabled, updated_at
        FROM member_notification_preferences_v1;
        DROP TABLE member_notification_preferences_v1;
      `);
      this.database
        .prepare(
          'INSERT INTO broadcast_schema_migrations (version, applied_at) VALUES (2, ?)',
        )
        .run(Date.now());
    })();
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error('Broadcast store is closed.');
  }
}

function toPolicy(row: PolicyRow): BroadcastPolicy {
  return {
    serverId: row.server_id,
    category: row.category,
    state: row.state,
    channelId: row.channel_id,
    timezone: row.timezone,
    ...(row.quiet_start_minute === null
      ? {}
      : { quietStartMinute: row.quiet_start_minute }),
    ...(row.quiet_end_minute === null
      ? {}
      : { quietEndMinute: row.quiet_end_minute }),
    minimumIntervalSeconds: row.minimum_interval_seconds,
    digestMode: row.digest_mode === 1,
    updatedAt: new Date(row.updated_at),
    ...(row.updated_by_user_id === null
      ? {}
      : { updatedByUserId: row.updated_by_user_id }),
  };
}

function toPreference(row: PreferenceRow): BroadcastMemberPreference {
  return {
    serverId: row.server_id,
    userId: row.user_id,
    category: row.category,
    enabled: row.enabled === 1,
    updatedAt: new Date(row.updated_at),
  };
}

function toDeliveryHealth(row: DeliveryRow): BroadcastDeliveryHealth {
  return {
    status: row.status,
    ...(row.claimed_at === null ? {} : { claimedAt: new Date(row.claimed_at) }),
    ...(row.completed_at === null
      ? {}
      : { completedAt: new Date(row.completed_at) }),
    ...(row.error_category === null
      ? {}
      : { errorCategory: row.error_category }),
  };
}

function validatePolicy(policy: BroadcastPolicy): void {
  if (!categories.includes(policy.category)) {
    throw new RangeError('Unsupported broadcast category.');
  }
  if (!states.includes(policy.state)) {
    throw new RangeError('Unsupported broadcast policy state.');
  }
  assertNonEmptyString(policy.serverId, 'Server ID');
  assertNonEmptyString(policy.channelId, 'Channel ID');
  assertNonEmptyString(policy.timezone, 'Timezone');
  new Intl.DateTimeFormat('en-US', { timeZone: policy.timezone });
  assertQuietHours(policy.quietStartMinute, policy.quietEndMinute);
  if (
    !Number.isSafeInteger(policy.minimumIntervalSeconds) ||
    policy.minimumIntervalSeconds < 0
  ) {
    throw new RangeError(
      'Minimum interval seconds must be a non-negative safe integer.',
    );
  }
  finiteDateMilliseconds(policy.updatedAt);
}

function validatePreference(preference: BroadcastMemberPreference): void {
  if (!categories.includes(preference.category)) {
    throw new RangeError('Unsupported broadcast category.');
  }
  assertNonEmptyString(preference.serverId, 'Server ID');
  assertNonEmptyString(preference.userId, 'User ID');
  finiteDateMilliseconds(preference.updatedAt);
}

function assertQuietHours(
  quietStartMinute: number | undefined,
  quietEndMinute: number | undefined,
): void {
  if (quietStartMinute === undefined && quietEndMinute === undefined) return;
  if (quietStartMinute === undefined || quietEndMinute === undefined) {
    throw new RangeError(
      'Quiet hours must include both start and end minutes.',
    );
  }
  if (
    !Number.isSafeInteger(quietStartMinute) ||
    !Number.isSafeInteger(quietEndMinute) ||
    quietStartMinute < 0 ||
    quietStartMinute > 1439 ||
    quietEndMinute < 0 ||
    quietEndMinute > 1439
  ) {
    throw new RangeError('Quiet-hour minutes must be between 0 and 1439.');
  }
}

function assertNonEmptyString(value: string, label: string): void {
  if (value.length === 0) throw new RangeError(`${label} must not be empty.`);
}

function finiteDateMilliseconds(value: unknown): number {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError('Expected a finite Date.');
  }
  return value.getTime();
}
