import Database from 'better-sqlite3';

export interface RssFeedRecord {
  readonly serverId: string;
  readonly url: string;
  readonly label: string;
  readonly paused: boolean;
  readonly baselined: boolean;
}

export class RssStorage {
  private readonly db: Database.Database;
  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('foreign_keys = ON');
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS rss_feeds (server_id TEXT NOT NULL, url TEXT NOT NULL, label TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (server_id, url)); CREATE TABLE IF NOT EXISTS rss_servers (server_id TEXT PRIMARY KEY, paused INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS rss_seen_items (server_id TEXT NOT NULL, item_key TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (server_id, item_key)); CREATE TABLE IF NOT EXISTS rss_feed_baselines (server_id TEXT NOT NULL, url TEXT NOT NULL, baselined_at INTEGER NOT NULL, PRIMARY KEY (server_id, url)); CREATE TABLE IF NOT EXISTS rss_completed_items (server_id TEXT NOT NULL, item_key TEXT NOT NULL, completed_day TEXT NOT NULL, completed_at INTEGER NOT NULL, PRIMARY KEY (server_id, item_key)); CREATE INDEX IF NOT EXISTS rss_completed_items_daily ON rss_completed_items(server_id, completed_day); CREATE TABLE IF NOT EXISTS rss_daily_delivery_reservations (server_id TEXT NOT NULL, item_key TEXT NOT NULL, delivery_day TEXT NOT NULL, lease_token TEXT NOT NULL, reserved_at INTEGER NOT NULL, PRIMARY KEY (server_id, item_key)); CREATE INDEX IF NOT EXISTS rss_daily_delivery_reservations_daily ON rss_daily_delivery_reservations(server_id, delivery_day, reserved_at);`,
    );
  }
  addFeed(serverId: string, url: string, label: string): void {
    this.db
      .prepare(
        'INSERT INTO rss_feeds (server_id,url,label,created_at) VALUES (?,?,?,?) ON CONFLICT(server_id,url) DO UPDATE SET label=excluded.label',
      )
      .run(serverId, url, label, Date.now());
  }
  listFeeds(serverId: string): RssFeedRecord[] {
    const paused = this.isPaused(serverId);
    return (
      this.db
        .prepare(
          `SELECT feeds.server_id as serverId, feeds.url, feeds.label,
                  baselines.server_id IS NOT NULL as baselined
           FROM rss_feeds feeds
           LEFT JOIN rss_feed_baselines baselines
             ON baselines.server_id = feeds.server_id AND baselines.url = feeds.url
           WHERE feeds.server_id = ?
           ORDER BY feeds.url`,
        )
        .all(serverId) as Array<{
        serverId: string;
        url: string;
        label: string;
        baselined: number;
      }>
    ).map((row) => ({ ...row, baselined: row.baselined === 1, paused }));
  }
  removeFeed(serverId: string, url: string): boolean {
    return (
      this.db
        .prepare('DELETE FROM rss_feeds WHERE server_id=? AND url=?')
        .run(serverId, url).changes > 0
    );
  }
  setPaused(serverId: string, paused: boolean): void {
    this.db
      .prepare(
        'INSERT INTO rss_servers (server_id,paused) VALUES (?,?) ON CONFLICT(server_id) DO UPDATE SET paused=excluded.paused',
      )
      .run(serverId, paused ? 1 : 0);
  }
  isPaused(serverId: string): boolean {
    return (
      Number(
        (
          this.db
            .prepare('SELECT paused FROM rss_servers WHERE server_id=?')
            .get(serverId) as { paused: number } | undefined
        )?.paused ?? 0,
      ) === 1
    );
  }
  claimItem(serverId: string, itemKey: string): boolean {
    return (
      this.db
        .prepare(
          'INSERT OR IGNORE INTO rss_seen_items (server_id,item_key,created_at) VALUES (?,?,?)',
        )
        .run(serverId, itemKey, Date.now()).changes > 0
    );
  }
  establishBaseline(
    serverId: string,
    url: string,
    itemIds: readonly string[],
  ): void {
    const establishedAt = Date.now();
    this.db.transaction(() => {
      this.db
        .prepare(
          'INSERT OR IGNORE INTO rss_feed_baselines (server_id,url,baselined_at) VALUES (?,?,?)',
        )
        .run(serverId, url, establishedAt);
      const insert = this.db.prepare(
        'INSERT OR IGNORE INTO rss_seen_items (server_id,item_key,created_at) VALUES (?,?,?)',
      );
      for (const itemId of itemIds) {
        insert.run(serverId, `${url}:${itemId}`, establishedAt);
      }
    })();
  }
  isBaselineItem(serverId: string, url: string, itemId: string): boolean {
    return (
      this.db
        .prepare(
          'SELECT 1 FROM rss_seen_items WHERE server_id=? AND item_key=?',
        )
        .get(serverId, `${url}:${itemId}`) !== undefined
    );
  }
  hasReachedDailyDeliveryLimit(serverId: string, now: Date): boolean {
    return this.remainingDailyDeliveryCapacity(serverId, now) === 0;
  }
  remainingDailyDeliveryCapacity(serverId: string, now: Date): number {
    const day = utcDay(now);
    const reservations = Number(
      (
        this.db
          .prepare(
            'SELECT COUNT(*) as count FROM rss_daily_delivery_reservations WHERE server_id=? AND delivery_day=? AND reserved_at>?',
          )
          .get(serverId, day, reservationCutoff(now)) as { count: number }
      ).count,
    );
    const completed = this.completedDailyDeliveryCount(serverId, day);
    return Math.max(0, dailyDeliveryLimit - completed - reservations);
  }
  reserveDailyDelivery(
    serverId: string,
    itemKey: string,
    leaseToken: string,
    now: Date,
  ): boolean {
    const day = utcDay(now);
    const reservedAt = now.getTime();
    return this.db.transaction(() => {
      this.db
        .prepare(
          'DELETE FROM rss_daily_delivery_reservations WHERE reserved_at<=?',
        )
        .run(reservationCutoff(now));
      const completed = this.db
        .prepare(
          'SELECT 1 FROM rss_completed_items WHERE server_id=? AND item_key=?',
        )
        .get(serverId, itemKey);
      if (completed !== undefined) return false;
      const existing = this.db
        .prepare(
          'SELECT lease_token FROM rss_daily_delivery_reservations WHERE server_id=? AND item_key=?',
        )
        .get(serverId, itemKey) as { lease_token: string } | undefined;
      if (existing !== undefined) return existing.lease_token === leaseToken;
      if (this.remainingDailyDeliveryCapacity(serverId, now) === 0)
        return false;
      return (
        this.db
          .prepare(
            'INSERT INTO rss_daily_delivery_reservations (server_id,item_key,delivery_day,lease_token,reserved_at) VALUES (?,?,?,?,?)',
          )
          .run(serverId, itemKey, day, leaseToken, reservedAt).changes === 1
      );
    })();
  }
  completeDailyDelivery(
    serverId: string,
    itemKey: string,
    leaseToken: string,
    now: Date,
  ): boolean {
    const completedAt = now.getTime();
    return this.db.transaction(() => {
      const reservation = this.db
        .prepare(
          'SELECT delivery_day FROM rss_daily_delivery_reservations WHERE server_id=? AND item_key=? AND lease_token=? AND reserved_at>?',
        )
        .get(serverId, itemKey, leaseToken, reservationCutoff(now)) as
        { delivery_day: string } | undefined;
      if (reservation === undefined) return false;
      const inserted =
        this.db
          .prepare(
            'INSERT OR IGNORE INTO rss_completed_items (server_id,item_key,completed_day,completed_at) VALUES (?,?,?,?)',
          )
          .run(serverId, itemKey, reservation.delivery_day, completedAt)
          .changes === 1;
      this.db
        .prepare(
          'DELETE FROM rss_daily_delivery_reservations WHERE server_id=? AND item_key=? AND lease_token=?',
        )
        .run(serverId, itemKey, leaseToken);
      return inserted;
    })();
  }
  rolloverDailyDeliveryReservation(
    serverId: string,
    itemKey: string,
    leaseToken: string,
    now: Date,
  ): boolean {
    const targetDay = utcDay(now);
    return this.db.transaction(() => {
      const reservation = this.db
        .prepare(
          'SELECT delivery_day FROM rss_daily_delivery_reservations WHERE server_id=? AND item_key=? AND lease_token=? AND reserved_at>?',
        )
        .get(serverId, itemKey, leaseToken, reservationCutoff(now)) as
        { delivery_day: string } | undefined;
      if (reservation === undefined) return false;
      if (reservation.delivery_day === targetDay) return true;
      if (this.remainingDailyDeliveryCapacity(serverId, now) === 0) {
        return false;
      }
      return (
        this.db
          .prepare(
            'UPDATE rss_daily_delivery_reservations SET delivery_day=?, reserved_at=? WHERE server_id=? AND item_key=? AND lease_token=?',
          )
          .run(targetDay, now.getTime(), serverId, itemKey, leaseToken)
          .changes === 1
      );
    })();
  }
  releaseDailyDelivery(
    serverId: string,
    itemKey: string,
    leaseToken: string,
  ): boolean {
    return (
      this.db
        .prepare(
          'DELETE FROM rss_daily_delivery_reservations WHERE server_id=? AND item_key=? AND lease_token=?',
        )
        .run(serverId, itemKey, leaseToken).changes === 1
    );
  }
  recordCompletedItem(serverId: string, itemKey: string, now: Date): boolean {
    const completedAt = now.getTime();
    return this.db.transaction(() => {
      const existing = this.db
        .prepare(
          'SELECT 1 FROM rss_completed_items WHERE server_id=? AND item_key=?',
        )
        .get(serverId, itemKey);
      if (
        existing !== undefined ||
        this.hasReachedDailyDeliveryLimit(serverId, now)
      ) {
        return false;
      }
      return (
        this.db
          .prepare(
            'INSERT INTO rss_completed_items (server_id,item_key,completed_day,completed_at) VALUES (?,?,?,?)',
          )
          .run(serverId, itemKey, utcDay(now), completedAt).changes === 1
      );
    })();
  }
  close(): void {
    this.db.close();
  }
  private completedDailyDeliveryCount(serverId: string, day: string): number {
    return Number(
      (
        this.db
          .prepare(
            'SELECT COUNT(*) as count FROM rss_completed_items WHERE server_id=? AND completed_day=?',
          )
          .get(serverId, day) as { count: number }
      ).count,
    );
  }
}

const utcDay = (now: Date): string => now.toISOString().slice(0, 10);
const dailyDeliveryLimit = 20;
const reservationLeaseMilliseconds = 5 * 60 * 1000;
const reservationCutoff = (now: Date): number =>
  now.getTime() - reservationLeaseMilliseconds;
