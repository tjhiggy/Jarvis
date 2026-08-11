import type {
  RssNotificationClient,
  RssNotification,
} from './rss-notifications.js';
import type { RssStorage, RssFeedRecord } from './rss-storage.js';
import type { BroadcastPolicyService } from './broadcast-policy.js';
import type { BroadcastStore } from './broadcast-store.js';

export interface RssDigestEntry extends RssNotification {
  readonly sourceLabel: string;
  readonly deliveryKey: string;
}

export interface RssDigest {
  readonly entries: readonly RssDigestEntry[];
}

export interface RssRenderedDigest {
  readonly content: string;
  readonly entries: readonly RssDigestEntry[];
  readonly deliveryKeys: readonly string[];
}

export interface RssSchedulerPublisher {
  publish(channelId: string, digest: RssRenderedDigest): Promise<void>;
}

export const renderRssDigest = (digest: RssDigest): RssRenderedDigest => {
  const header = '**RSS update**';
  const entries: RssDigestEntry[] = [];
  let content = header;
  for (const entry of digest.entries.slice(0, 5)) {
    const rendered = renderRssDigestEntry(entry);
    if (
      rendered === undefined ||
      content.length + 2 + rendered.length > 1_900
    ) {
      continue;
    }
    entries.push(entry);
    content += `\n\n${rendered}`;
  }
  return {
    content:
      entries.length === 0
        ? `${header}\nNo bounded entries available.`
        : content,
    entries,
    deliveryKeys: entries.map((entry) => entry.deliveryKey),
  };
};

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
      | 'remainingDailyDeliveryCapacity'
      | 'reserveDailyDelivery'
      | 'completeDailyDelivery'
      | 'releaseDailyDelivery'
      | 'rolloverDailyDeliveryReservation'
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
      const cycleCapacity = Math.min(
        5,
        this.storage.remainingDailyDeliveryCapacity(this.serverId, startedAt),
      );
      if (cycleCapacity === 0) return 0;
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
          if (claimed.length >= cycleCapacity) break;
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
          if (
            !this.storage.reserveDailyDelivery(
              this.serverId,
              key,
              lease,
              startedAt,
            )
          ) {
            await this.deliveryStore.releaseDelivery(
              this.serverId,
              'rss',
              key,
              lease,
              this.now(),
            );
            continue;
          }
          claimed.push({
            key,
            lease,
            entry: { ...item, sourceLabel: feed.label, deliveryKey: key },
          });
        }
        if (claimed.length >= cycleCapacity) break;
      }
      if (claimed.length === 0) return 0;

      const release = async (
        deliveries: readonly (typeof claimed)[number][],
        errorCategory?: 'network',
      ): Promise<void> => {
        await Promise.all(
          deliveries.map(async ({ key, lease }) => {
            this.storage.releaseDailyDelivery(this.serverId, key, lease);
            await this.deliveryStore.releaseDelivery(
              this.serverId,
              'rss',
              key,
              lease,
              this.now(),
              errorCategory,
            );
          }),
        );
      };

      const policyAllowsPost = async (): Promise<boolean> =>
        (
          await this.policy.evaluate({
            serverId: this.serverId,
            category: 'rss',
            channelId: this.channelId,
            now: this.now(),
            globallyPaused: this.storage.isPaused(this.serverId),
          })
        ).allowed;

      const complete = async (
        delivery: (typeof claimed)[number],
      ): Promise<boolean> => {
        const completedAt = this.now();
        this.storage.completeDailyDelivery(
          this.serverId,
          delivery.key,
          delivery.lease,
          completedAt,
        );
        const completed = await this.deliveryStore.completeDelivery(
          this.serverId,
          'rss',
          delivery.key,
          delivery.lease,
          completedAt,
        );
        return completed;
      };

      if (!digestMode) {
        let published = 0;
        for (const [index, delivery] of claimed.entries()) {
          const rendered = renderRssDigest({ entries: [delivery.entry] });
          if (!rendered.deliveryKeys.includes(delivery.key)) {
            await release([delivery]);
            continue;
          }
          if (!(await policyAllowsPost())) {
            await release(claimed.slice(index));
            return published;
          }
          if (
            !this.storage.rolloverDailyDeliveryReservation(
              this.serverId,
              delivery.key,
              delivery.lease,
              this.now(),
            )
          ) {
            await release([delivery]);
            continue;
          }
          try {
            await this.publisher.publish(this.channelId, rendered);
          } catch {
            await release([delivery], 'network');
            await release(claimed.slice(index + 1));
            return published;
          }
          if (await complete(delivery)) published += 1;
        }
        return published;
      }

      const rendered = renderRssDigest({
        entries: claimed.map(({ entry }) => entry),
      });
      if (rendered.deliveryKeys.length === 0) {
        await release(claimed);
        return 0;
      }

      if (!(await policyAllowsPost())) {
        await release(claimed);
        return 0;
      }

      const postable = [] as (typeof claimed)[number][];
      for (const delivery of claimed) {
        if (
          this.storage.rolloverDailyDeliveryReservation(
            this.serverId,
            delivery.key,
            delivery.lease,
            this.now(),
          )
        ) {
          postable.push(delivery);
        } else {
          await release([delivery]);
        }
      }
      if (postable.length === 0) return 0;

      const postableRendered = renderRssDigest({
        entries: postable.map(({ entry }) => entry),
      });
      if (postableRendered.deliveryKeys.length === 0) {
        await release(postable);
        return 0;
      }

      try {
        await this.publisher.publish(this.channelId, postableRendered);
      } catch {
        await release(postable, 'network');
        return 0;
      }

      let published = 0;
      for (const delivery of postable) {
        if (postableRendered.deliveryKeys.includes(delivery.key)) {
          if (await complete(delivery)) published += 1;
        } else {
          await release([delivery]);
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

const boundedRssText = (value: string, limit: number): string =>
  value.replace(/\s+/g, ' ').trim().slice(0, limit);

const renderRssDigestEntry = (entry: RssDigestEntry): string | undefined => {
  const url = entry.url.trim();
  if (url === '' || url.length > 400) return undefined;
  return `**${boundedRssText(entry.sourceLabel, 64)}** · ${boundedRssText(entry.title, 180)}\n${url}\n${boundedRssText(entry.publishedAt, 64)}`;
};
