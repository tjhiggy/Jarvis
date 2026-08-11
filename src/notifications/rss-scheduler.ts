import type {
  RssNotificationClient,
  RssNotification,
} from './rss-notifications.js';
import type { RssStorage, RssFeedRecord } from './rss-storage.js';
import type { BroadcastPolicyService } from './broadcast-policy.js';
import type { BroadcastStore } from './broadcast-store.js';

export interface RssDigestEntry extends RssNotification {
  readonly sourceLabel: string;
}

export interface RssDigest {
  readonly entries: readonly RssDigestEntry[];
}

export interface RssSchedulerPublisher {
  publish(channelId: string, digest: RssDigest): Promise<void>;
}

export class RssScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private active = false;
  constructor(
    private readonly storage: Pick<
      RssStorage,
      | 'listFeeds'
      | 'isPaused'
      | 'establishBaseline'
      | 'isBaselineItem'
      | 'hasReachedDailyDeliveryLimit'
      | 'recordCompletedItem'
    >,
    private readonly client: Pick<RssNotificationClient, 'fetch'>,
    private readonly publisher: RssSchedulerPublisher,
    private readonly serverId: string,
    private readonly channelId: string,
    private readonly policy: Pick<BroadcastPolicyService, 'evaluate'>,
    private readonly deliveryStore: Pick<
      BroadcastStore,
      'getPolicy' | 'claimDelivery' | 'completeDelivery' | 'releaseDelivery'
    >,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async tick(): Promise<number> {
    if (this.active || !this.channelId || this.storage.isPaused(this.serverId))
      return 0;
    this.active = true;
    try {
      const startedAt = this.now();
      const decision = await this.policy.evaluate({
        serverId: this.serverId,
        category: 'rss',
        channelId: this.channelId,
        now: startedAt,
        globallyPaused: this.storage.isPaused(this.serverId),
      });
      if (!decision.allowed) return 0;
      const digestMode =
        (await this.deliveryStore.getPolicy(this.serverId, 'rss'))
          ?.digestMode ?? true;
      const claimed: Array<{
        readonly key: string;
        readonly lease: string;
        readonly entry: RssDigestEntry;
      }> = [];
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
        if (!feed.baselined) {
          this.storage.establishBaseline(
            this.serverId,
            feed.url,
            items.map((item) => item.id),
          );
          continue;
        }
        for (const item of items) {
          if (
            claimed.length >= 5 ||
            this.storage.hasReachedDailyDeliveryLimit(this.serverId, startedAt)
          )
            break;
          if (this.storage.isBaselineItem(this.serverId, feed.url, item.id))
            continue;
          const key = `${feed.url}:${item.id}`;
          const lease = await this.deliveryStore.claimDelivery(
            this.serverId,
            'rss',
            key,
            startedAt,
          );
          if (lease === undefined) continue;
          claimed.push({
            key,
            lease,
            entry: { ...item, sourceLabel: feed.label },
          });
        }
        if (
          claimed.length >= 5 ||
          this.storage.hasReachedDailyDeliveryLimit(this.serverId, startedAt)
        )
          break;
      }
      if (claimed.length === 0) return 0;

      const beforePost = await this.policy.evaluate({
        serverId: this.serverId,
        category: 'rss',
        channelId: this.channelId,
        now: this.now(),
        globallyPaused: this.storage.isPaused(this.serverId),
      });
      if (!beforePost.allowed) {
        await Promise.all(
          claimed.map(({ key, lease }) =>
            this.deliveryStore.releaseDelivery(
              this.serverId,
              'rss',
              key,
              lease,
              this.now(),
            ),
          ),
        );
        return 0;
      }

      try {
        if (digestMode) {
          await this.publisher.publish(this.channelId, {
            entries: claimed.map(({ entry }) => entry),
          });
        } else {
          for (const { entry } of claimed) {
            await this.publisher.publish(this.channelId, { entries: [entry] });
          }
        }
      } catch {
        await Promise.all(
          claimed.map(({ key, lease }) =>
            this.deliveryStore.releaseDelivery(
              this.serverId,
              'rss',
              key,
              lease,
              this.now(),
              'network',
            ),
          ),
        );
        return 0;
      }

      const completedAt = this.now();
      let published = 0;
      for (const { key, lease } of claimed) {
        if (
          await this.deliveryStore.completeDelivery(
            this.serverId,
            'rss',
            key,
            lease,
            completedAt,
          )
        ) {
          this.storage.recordCompletedItem(this.serverId, key, completedAt);
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
