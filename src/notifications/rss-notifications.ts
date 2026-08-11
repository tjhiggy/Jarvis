export interface RssNotification {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly publishedAt: string;
}

const privateHost = (hostname: string): boolean => {
  const value = hostname.toLowerCase();
  return (
    value === 'localhost' ||
    value === '::1' ||
    value === '0.0.0.0' ||
    value.startsWith('127.') ||
    value.startsWith('10.') ||
    value.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(value)
  );
};

export const isAllowedRssUrl = (
  value: string,
  allowedHosts: readonly string[],
): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !privateHost(url.hostname) &&
      allowedHosts.some(
        (host) => host.toLowerCase() === url.hostname.toLowerCase(),
      )
    );
  } catch {
    return false;
  }
};

const decode = (value: string): string =>
  value
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();

const canonicalUrl = (value: string): string => {
  try {
    return new URL(decode(value)).toString();
  } catch {
    return '';
  }
};

export class RssNotificationClient {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 8_000,
    private readonly allowedHosts: readonly string[] = [],
  ) {}

  async fetch(
    feedUrl: string,
    maximumItems = 20,
  ): Promise<readonly RssNotification[]> {
    if (!isAllowedRssUrl(feedUrl, this.allowedHosts))
      throw new Error('RSS feed is not allowlisted.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(feedUrl, {
        headers: { accept: 'application/rss+xml, application/xml, text/xml' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('RSS feed unavailable.');
      const xml = (await response.text()).slice(0, 512_000);
      return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
        .slice(0, Math.min(Math.max(0, maximumItems), 20))
        .map((match) => {
          const item = match[1] ?? '';
          return {
            id: decode(
              item.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1] ??
                item.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] ??
                '',
            ),
            title: decode(
              item.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ??
                'RSS update',
            ),
            url: canonicalUrl(
              item.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? '',
            ),
            publishedAt: decode(
              item.match(
                /<(?:pubDate|published)[^>]*>([\s\S]*?)<\/(?:pubDate|published)>/i,
              )?.[1] ?? '',
            ),
          };
        })
        .filter((item) => item.id !== '' && item.url !== '');
    } finally {
      clearTimeout(timer);
    }
  }
}
