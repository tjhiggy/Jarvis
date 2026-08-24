import { describe, expect, it, vi } from 'vitest';
import {
  RssNotificationClient,
  createPublicRssLookup,
  isAllowedRssUrl,
} from '../src/notifications/rss-notifications.js';

describe('RSS notifications', () => {
  it('accepts only HTTPS URLs on the configured allowlist', () => {
    expect(
      isAllowedRssUrl('https://news.example.com/feed.xml', [
        'news.example.com',
      ]),
    ).toBe(true);
    expect(
      isAllowedRssUrl('http://news.example.com/feed.xml', ['news.example.com']),
    ).toBe(false);
    expect(isAllowedRssUrl('https://127.0.0.1/feed.xml', ['127.0.0.1'])).toBe(
      false,
    );
    expect(
      isAllowedRssUrl('https://evil.example.com/feed.xml', [
        'news.example.com',
      ]),
    ).toBe(false);
  });

  it('parses bounded RSS items and rejects oversized feeds', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          `<?xml version="1.0"?><rss><channel><item><guid>a1</guid><title>First update</title><link>https://news.example.com/a</link><pubDate>Mon, 01 Jan 2026 00:00:00 GMT</pubDate></item></channel></rss>`,
        ),
      );
    const client = new RssNotificationClient(fetcher, 2_000, [
      'news.example.com',
    ]);
    const items = await client.fetch('https://news.example.com/feed.xml');
    expect(items).toEqual([
      {
        id: 'a1',
        title: 'First update',
        url: 'https://news.example.com/a',
        publishedAt: 'Mon, 01 Jan 2026 00:00:00 GMT',
      },
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'https://news.example.com/feed.xml',
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '169.254.169.254',
    '192.168.1.1',
    '::1',
    'fec0::1',
    'fe80::1',
    'fc00::1',
  ])(
    'rejects an allowlisted hostname resolving to non-public address %s',
    async (address) => {
      const lookup = createPublicRssLookup(async () => [
        { address, family: address.includes(':') ? 6 : 4 },
      ]);

      await expect(
        new Promise((resolve, reject) =>
          lookup('feeds.example.com', { all: true }, (error, addresses) =>
            error === null ? resolve(addresses) : reject(error),
          ),
        ),
      ).rejects.toThrow('RSS host did not resolve to a public address.');
    },
  );

  it('returns only public DNS results for the socket connection', async () => {
    const lookup = createPublicRssLookup(async () => [
      { address: '8.8.8.8', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);

    await expect(
      new Promise((resolve, reject) =>
        lookup('feeds.example.com', { all: true }, (error, addresses) =>
          error === null ? resolve(addresses) : reject(error),
        ),
      ),
    ).resolves.toEqual([
      { address: '8.8.8.8', family: 4 },
      { address: '2606:4700:4700::1111', family: 6 },
    ]);
  });

  it('canonicalizes item URLs and applies the requested parsed-entry bound', async () => {
    const entries = Array.from(
      { length: 25 },
      (_, index) =>
        `<item><guid>item-${index}</guid><title>Item ${index}</title><link>https://news.example.com/post/${index}/../${index}</link><pubDate>2026-08-11</pubDate></item>`,
    ).join('');
    const client = new RssNotificationClient(
      vi
        .fn()
        .mockResolvedValue(
          new Response(`<rss><channel>${entries}</channel></rss>`),
        ),
      2_000,
      ['news.example.com'],
    );

    const items = await client.fetch('https://news.example.com/feed.xml', 5);

    expect(items).toHaveLength(5);
    expect(items[0]).toMatchObject({ url: 'https://news.example.com/post/0' });
  });
});
