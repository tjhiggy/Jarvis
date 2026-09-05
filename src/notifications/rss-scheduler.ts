import { MessageFlags } from 'discord.js';
import {
  sanitizeRssImageUrl,
  type RssNotificationClient,
  type RssNotification,
} from './rss-notifications.js';
import type { RssStorage, RssFeedRecord } from './rss-storage.js';
import type { BroadcastPolicyService } from './broadcast-policy.js';
import type { BroadcastStore } from './broadcast-store.js';
import { projectOperationalError } from '../utils/logger.js';

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

export interface RssBroadcastEmbed {
  readonly title: string;
  readonly url: string;
  readonly author: { readonly name: string };
  readonly image?: { readonly url: string };
}

export interface RssBroadcastSendPayload {
  readonly content: string;
  readonly embeds: readonly [RssBroadcastEmbed];
  readonly allowedMentions: {
    readonly parse: readonly [];
    readonly repliedUser: false;
  };
}

export interface RssBroadcastVisibilityItem {
  readonly title: string;
  readonly url: string;
}

export interface RssBroadcastVisibilityPayload {
  readonly content?: string;
  readonly embeds?: readonly {
    readonly title?: string;
    readonly url?: string;
  }[];
  readonly flags?: number;
}

const RSS_CYCLE_CAPACITY = 1;
const RSS_CATCH_UP_MAX_AGE_MS = 2 * 60 * 60 * 1_000;
export const RSS_POLL_INTERVAL_MS = 300_000;

export const rotateRssFeeds = <T>(feeds: readonly T[], now: Date): T[] => {
  if (feeds.length <= 1) return [...feeds];
  const offset =
    Math.floor(now.getTime() / RSS_POLL_INTERVAL_MS) % feeds.length;
  return [...feeds.slice(offset), ...feeds.slice(0, offset)];
};

const boundedRssText = (value: string, limit: number): string =>
  value.replace(/\s+/g, ' ').trim().slice(0, limit);

export const parseRssItemTimestamp = (
  value: string | undefined,
): Date | undefined => {
  const raw = value?.trim() ?? '';
  if (raw === '') return undefined;
  const parsed = Date.parse(raw);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed);
};

export const rssCatchUpItemIsFresh = (
  publishedAt: string | undefined,
  now: Date,
  maxAgeMs = RSS_CATCH_UP_MAX_AGE_MS,
): boolean => {
  const availableAt = parseRssItemTimestamp(publishedAt);
  if (availableAt === undefined) return false;
  return now.getTime() - availableAt.getTime() <= maxAgeMs;
};

export const formatRssBroadcastContent = (
  entry: Pick<RssDigestEntry, 'title' | 'url' | 'sourceLabel'> & {
    readonly publishedAt?: string;
  },
): string => {
  const source = boundedRssText(entry.sourceLabel, 64);
  const title = boundedRssText(entry.title, 180);
  const url = entry.url.trim();
  const publishedAt = boundedRssText(entry.publishedAt ?? '', 64);
  return publishedAt === ''
    ? `**${source}** · ${title}\n${url}`
    : `**${source}** · ${title}\n${url}\n${publishedAt}`;
};

export const rssBroadcastShowsItem = (
  payload: RssBroadcastVisibilityPayload,
  item: RssBroadcastVisibilityItem,
): boolean => {
  const title = boundedRssText(item.title, 180);
  const url = item.url.trim();
  if (title === '' || url === '') return false;
  const content = payload.content?.trim() ?? '';
  if (content.includes(title) && content.includes(url)) return true;
  const embedsSuppressed =
    (Number(payload.flags ?? 0) & MessageFlags.SuppressEmbeds) ===
    MessageFlags.SuppressEmbeds;
  if (embedsSuppressed) return false;
  const embed = payload.embeds?.[0];
  return embed?.title === title && embed.url === url;
};

export const rssBroadcastSendPayload = (
  entry: Pick<RssDigestEntry, 'title' | 'url' | 'sourceLabel'> & {
    readonly imageUrl?: string;
    readonly publishedAt?: string;
  },
): RssBroadcastSendPayload => {
  const title = boundedRssText(entry.title, 180);
  const url = entry.url.trim();
  const imageUrl = sanitizeRssImageUrl(entry.imageUrl);
  const payload: RssBroadcastSendPayload = {
    content: '',
    embeds: [
      {
        title,
        url,
        author: { name: boundedRssText(entry.sourceLabel, 64) },
        ...(imageUrl === undefined ? {} : { image: { url: imageUrl } }),
      },
    ],
    allowedMentions: { parse: [], repliedUser: false },
  };
  if (!rssBroadcastShowsItem(payload, { title, url })) {
    throw new Error('RSS payload has no visible title and link.');
  }
  return payload;
};

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
  private activeTick: Promise<number> | undefined;
  private acceptingTicks = true;
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
      | 'getPolicy'
      | 'claimDelivery'
      | 'completeDelivery'
      | 'releaseDelivery'
      | 'deliveryHealth'
    >,
    private readonly now: () => Date = () => new Date(),
    private readonly logger?: {
      warn(fields: Record<string, string>, message: string): void;
    },
  ) {}
  async tick(): Promise<number> {
    if (this.activeTick !== undefined) return this.activeTick;
    if (!this.acceptingTicks) return 0;
    if (!this.channelId || this.storage.isPaused(this.serverId)) return 0;
    this.activeTick = this.runTick().finally(() => {
      this.activeTick = undefined;
    });
    return this.activeTick;
  }
  private runTick(): Promise<number> {
    return (async () => {
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
        RSS_CYCLE_CAPACITY,
        this.storage.remainingDailyDeliveryCapacity(this.serverId, startedAt),
      );
      if (cycleCapacity === 0) return 0;
      const claimed: Array<{
        readonly key: string;
        readonly lease: string;
        readonly entry: RssDigestEntry;
      }> = [];
      const feeds = rotateRssFeeds(
        this.storage
          .listFeeds(this.serverId)
          .filter((feed: RssFeedRecord) => !feed.paused)
          .slice(0, 20),
        startedAt,
      );
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
          if (!rssCatchUpItemIsFresh(item.publishedAt, startedAt)) {
            const health = await this.deliveryStore.deliveryHealth(
              this.serverId,
              'rss',
              key,
            );
            if (health === undefined || health.status === 'completed') continue;
          }
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
          if (!(await policyAllowsPost())) {
            await release(claimed.slice(index));
            return published;
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

      const remaining = postable.filter((delivery) =>
        postableRendered.deliveryKeys.includes(delivery.key),
      );
      const omitted = postable.filter(
        (delivery) => !postableRendered.deliveryKeys.includes(delivery.key),
      );
      if (omitted.length > 0) await release(omitted);

      let published = 0;
      for (const [index, delivery] of remaining.entries()) {
        const rendered = renderRssDigest({ entries: [delivery.entry] });
        if (!rendered.deliveryKeys.includes(delivery.key)) {
          await release([delivery]);
          continue;
        }
        if (!(await policyAllowsPost())) {
          await release(remaining.slice(index));
          return published;
        }
        try {
          await this.publisher.publish(this.channelId, rendered);
        } catch {
          await release([delivery], 'network');
          await release(remaining.slice(index + 1));
          return published;
        }
        if (await complete(delivery)) published += 1;
      }
      return published;
    })();
  }
  start(intervalMs = RSS_POLL_INTERVAL_MS): void {
    if (this.timer !== undefined) return;
    this.acceptingTicks = true;
    this.timer = setInterval(() => {
      if (this.timer === undefined) return;
      void this.tick().catch((error: unknown) =>
        this.logger?.warn(
          {
            operation: 'rss_tick',
            ...projectOperationalError(error, 'rss_scheduler'),
          },
          'RSS scheduler tick failed.',
        ),
      );
    }, intervalMs);
  }
  async stop(): Promise<void> {
    this.acceptingTicks = false;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    await this.activeTick?.catch(() => undefined);
  }
}

const renderRssDigestEntry = (entry: RssDigestEntry): string | undefined => {
  const url = entry.url.trim();
  if (url === '' || url.length > 400) return undefined;
  return formatRssBroadcastContent(entry);
};
