export type StreamProvider = 'youtube' | 'twitch';

export interface StreamNotification {
  readonly id: string;
  readonly provider: StreamProvider;
  readonly title: string;
  readonly url: string;
  readonly publishedAt: string;
  readonly channelName?: string;
}

export interface StreamFeed {
  readonly provider: StreamProvider;
  readonly id: string;
  readonly label: string;
}

export interface StreamNotificationClient {
  fetch(feed: StreamFeed): Promise<readonly StreamNotification[]>;
}

export interface StreamNotificationStore {
  seen(key: string): Promise<boolean>;
  markSeen(key: string): Promise<void>;
}

export interface StreamNotificationPublisher {
  publish(channelId: string, notification: StreamNotification): Promise<void>;
}

export class StreamNotificationError extends Error {
  constructor(public readonly code: 'unavailable' | 'not-configured', message: string) {
    super(message);
    this.name = 'StreamNotificationError';
  }
}

const timeoutFetch = async (url: string, timeoutMs: number, init?: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    throw new StreamNotificationError('unavailable', 'The stream service is temporarily unavailable.');
  } finally {
    clearTimeout(timer);
  }
};

const decode = (value: string): string => value.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

export class HttpStreamNotificationClient implements StreamNotificationClient {
  constructor(
    private readonly timeoutMs = 8_000,
    private readonly twitchClientId = '',
    private readonly twitchAccessToken = '',
  ) {}

  async fetch(feed: StreamFeed): Promise<readonly StreamNotification[]> {
    if (feed.provider === 'youtube') {
      const response = await timeoutFetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(feed.id)}`, this.timeoutMs, { headers: { accept: 'application/atom+xml' } });
      if (!response.ok) throw new StreamNotificationError('unavailable', 'YouTube is temporarily unavailable.');
      const xml = await response.text();
      return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => {
        const item = match[1] ?? '';
        const id = decode(item.match(/<yt:videoId>([\s\S]*?)<\/yt:videoId>/)?.[1] ?? '');
        return { id, provider: 'youtube' as const, title: decode(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? feed.label), url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`, publishedAt: decode(item.match(/<published>([\s\S]*?)<\/published>/)?.[1] ?? ''), channelName: feed.label };
      }).filter((item) => item.id !== '');
    }
    if (!this.twitchClientId || !this.twitchAccessToken) throw new StreamNotificationError('not-configured', 'Twitch notifications require optional API credentials.');
    const response = await timeoutFetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(feed.id)}`, this.timeoutMs, { headers: { 'Client-ID': this.twitchClientId, Authorization: `Bearer ${this.twitchAccessToken}`, accept: 'application/json' } });
    if (!response.ok) throw new StreamNotificationError('unavailable', 'Twitch is temporarily unavailable.');
    const body = await response.json() as { data?: Array<{ id: string; title: string; user_name: string; started_at: string }> };
    return (body.data ?? []).map((item) => ({ id: item.id, provider: 'twitch' as const, title: item.title, url: `https://twitch.tv/${encodeURIComponent(feed.id)}`, publishedAt: item.started_at, channelName: item.user_name }));
  }
}

export class StreamNotificationService {
  constructor(private readonly client: StreamNotificationClient, private readonly store: StreamNotificationStore, private readonly publisher: StreamNotificationPublisher, private readonly channelId: string) {}

  async poll(feeds: readonly StreamFeed[]): Promise<number> {
    if (!this.channelId) return 0;
    let published = 0;
    for (const feed of feeds.slice(0, 20)) {
      let items: readonly StreamNotification[];
      try { items = await this.client.fetch(feed); } catch (error) { if (error instanceof StreamNotificationError && error.code === 'not-configured') continue; continue; }
      for (const item of items.slice(0, 5)) {
        const key = `${item.provider}:${item.id}`;
        if (await this.store.seen(key)) continue;
        await this.store.markSeen(key);
        await this.publisher.publish(this.channelId, item);
        published += 1;
      }
    }
    return published;
  }
}
