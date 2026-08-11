import { describe, expect, it, vi } from 'vitest';
import {
  RssNotificationClient,
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
  });
});
