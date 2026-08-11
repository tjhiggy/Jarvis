import type {
  RssNotificationClient,
  RssNotification,
} from './rss-notifications.js';
import type { RssStorage, RssFeedRecord } from './rss-storage.js';

export interface RssSchedulerPublisher {
  publish(channelId: string, item: RssNotification): Promise<void>;
}

export class RssScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private active = false;
  constructor(
    private readonly storage: Pick<
      RssStorage,
      'listFeeds' | 'isPaused' | 'claimItem'
    >,
    private readonly client: Pick<RssNotificationClient, 'fetch'>,
    private readonly publisher: RssSchedulerPublisher,
    private readonly serverId: string,
    private readonly channelId: string,
  ) {}
  async tick(): Promise<number> {
    if (this.active || !this.channelId || this.storage.isPaused(this.serverId))
      return 0;
    this.active = true;
    try {
      let published = 0;
      const feeds = this.storage
        .listFeeds(this.serverId)
        .filter((feed: RssFeedRecord) => !feed.paused)
        .slice(0, 20);
      for (const feed of feeds) {
        let items: readonly RssNotification[];
        try {
          items = await this.client.fetch(feed.url);
        } catch {
          continue;
        }
        for (const item of items.slice(0, 5)) {
          if (!this.storage.claimItem(this.serverId, `${feed.url}:${item.id}`))
            continue;
          await this.publisher.publish(this.channelId, item);
          published += 1;
        }
      }
      return published;
    } finally {
      this.active = false;
    }
  }
  start(intervalMs = 300_000): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, intervalMs);
  }
  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }
}
