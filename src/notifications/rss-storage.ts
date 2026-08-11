import Database from 'better-sqlite3';

export interface RssFeedRecord {
  readonly serverId: string;
  readonly url: string;
  readonly label: string;
  readonly paused: boolean;
}

export class RssStorage {
  private readonly db: Database.Database;
  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('foreign_keys = ON');
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS rss_feeds (server_id TEXT NOT NULL, url TEXT NOT NULL, label TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (server_id, url)); CREATE TABLE IF NOT EXISTS rss_servers (server_id TEXT PRIMARY KEY, paused INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS rss_seen_items (server_id TEXT NOT NULL, item_key TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (server_id, item_key));`,
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
          'SELECT server_id as serverId,url,label FROM rss_feeds WHERE server_id=? ORDER BY url',
        )
        .all(serverId) as Array<{
        serverId: string;
        url: string;
        label: string;
      }>
    ).map((row) => ({ ...row, paused }));
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
  close(): void {
    this.db.close();
  }
}
