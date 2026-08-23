import Database from 'better-sqlite3';
import { openSqliteDatabase } from '../storage/open-sqlite-database.js';

const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const COMMAND_PATTERN = /^[a-z0-9-]{1,64}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const RETENTION_DAYS = 30;

export interface MemberStatisticsStatus {
  readonly enabled: boolean;
  readonly commandCount: number;
}

export class SQLiteMemberStatisticsStore {
  private readonly database: Database.Database;

  constructor(databasePath: string) {
    this.database = openSqliteDatabase(databasePath);
    try {
      this.database.exec(`
      CREATE TABLE IF NOT EXISTS member_statistics_preferences (
        server_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (server_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS member_statistics_daily (
        server_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        metric_day TEXT NOT NULL,
        command TEXT NOT NULL,
        event_count INTEGER NOT NULL CHECK (event_count >= 0),
        PRIMARY KEY (server_id, user_id, metric_day, command)
      );
      CREATE INDEX IF NOT EXISTS idx_member_statistics_daily_day
        ON member_statistics_daily(metric_day);
    `);
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  enabled(serverId: string, userId: string): boolean {
    validateId(serverId, 'serverId');
    validateId(userId, 'userId');
    const row = this.database
      .prepare(
        `SELECT enabled FROM member_statistics_preferences
         WHERE server_id = ? AND user_id = ?`,
      )
      .get(serverId, userId) as { enabled: number } | undefined;
    return row?.enabled === 1;
  }

  setEnabled(
    serverId: string,
    userId: string,
    enabled: boolean,
    updatedAt: number,
  ): void {
    validateId(serverId, 'serverId');
    validateId(userId, 'userId');
    this.database
      .prepare(
        `INSERT INTO member_statistics_preferences
           (server_id, user_id, enabled, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(server_id, user_id) DO UPDATE SET
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`,
      )
      .run(serverId, userId, enabled ? 1 : 0, updatedAt);
  }

  record(serverId: string, userId: string, day: string, command: string): void {
    validateId(serverId, 'serverId');
    validateId(userId, 'userId');
    if (!DAY_PATTERN.test(day)) throw new Error('Invalid metric day.');
    if (!COMMAND_PATTERN.test(command)) throw new Error('Invalid command.');
    if (!this.enabled(serverId, userId)) return;
    this.database
      .prepare(
        `INSERT INTO member_statistics_daily
           (server_id, user_id, metric_day, command, event_count)
         VALUES (?, ?, ?, ?, 1)
         ON CONFLICT(server_id, user_id, metric_day, command) DO UPDATE SET
           event_count = event_count + 1`,
      )
      .run(serverId, userId, day, command);
  }

  count(serverId: string, userId: string, sinceDay: string): number {
    validateId(serverId, 'serverId');
    validateId(userId, 'userId');
    if (!DAY_PATTERN.test(sinceDay)) throw new Error('Invalid cutoff day.');
    const row = this.database
      .prepare(
        `SELECT COALESCE(SUM(event_count), 0) AS count
         FROM member_statistics_daily
         WHERE server_id = ? AND user_id = ? AND metric_day >= ?`,
      )
      .get(serverId, userId, sinceDay) as { count: number };
    return row.count;
  }

  optedInCount(serverId: string): number {
    validateId(serverId, 'serverId');
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM member_statistics_preferences
         WHERE server_id = ? AND enabled = 1`,
      )
      .get(serverId) as { count: number };
    return row.count;
  }

  disableAndDelete(serverId: string, userId: string, updatedAt: number): void {
    validateId(serverId, 'serverId');
    validateId(userId, 'userId');
    this.database.transaction(() => {
      this.database
        .prepare(
          `DELETE FROM member_statistics_daily
           WHERE server_id = ? AND user_id = ?`,
        )
        .run(serverId, userId);
      this.setEnabled(serverId, userId, false, updatedAt);
    })();
  }

  cleanup(cutoffDay: string): number {
    if (!DAY_PATTERN.test(cutoffDay)) throw new Error('Invalid cutoff day.');
    return this.database
      .prepare('DELETE FROM member_statistics_daily WHERE metric_day < ?')
      .run(cutoffDay).changes;
  }

  close(): void {
    this.database.close();
  }
}

export class MemberStatisticsService {
  constructor(private readonly store: SQLiteMemberStatisticsStore) {}

  async enable(
    serverId: string,
    userId: string,
    now = new Date(),
  ): Promise<void> {
    this.store.setEnabled(serverId, userId, true, now.getTime());
  }

  async disable(
    serverId: string,
    userId: string,
    now = new Date(),
  ): Promise<void> {
    this.store.disableAndDelete(serverId, userId, now.getTime());
  }

  async recordCommand(
    serverId: string,
    userId: string,
    command: string,
    occurredAt = new Date(),
  ): Promise<void> {
    this.store.record(serverId, userId, day(occurredAt), command);
  }

  async status(
    serverId: string,
    userId: string,
    now = new Date(),
  ): Promise<MemberStatisticsStatus> {
    const since = new Date(now);
    since.setUTCDate(since.getUTCDate() - (RETENTION_DAYS - 1));
    return {
      enabled: this.store.enabled(serverId, userId),
      commandCount: this.store.count(serverId, userId, day(since)),
    };
  }

  async cleanup(now = new Date()): Promise<number> {
    const cutoff = new Date(now);
    cutoff.setUTCDate(cutoff.getUTCDate() - (RETENTION_DAYS - 1));
    return this.store.cleanup(day(cutoff));
  }

  async optedInCount(serverId: string): Promise<number> {
    return this.store.optedInCount(serverId);
  }
}

const day = (value: Date): string => value.toISOString().slice(0, 10);

const validateId = (value: string, label: string): void => {
  if (!ID_PATTERN.test(value)) throw new Error(`Invalid ${label}.`);
};
