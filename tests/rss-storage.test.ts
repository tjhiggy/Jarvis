import { describe, expect, it } from 'vitest';
import { RssStorage } from '../src/notifications/rss-storage.js';

describe('RssStorage', () => {
  it('stores feeds per server and claims an item only once', () => {
    const storage = new RssStorage(':memory:');
    storage.addFeed('server-a', 'https://news.example.com/feed.xml', 'News');
    expect(storage.listFeeds('server-a')).toHaveLength(1);
    expect(storage.listFeeds('server-b')).toHaveLength(0);
    expect(storage.claimItem('server-a', 'guid-1')).toBe(true);
    expect(storage.claimItem('server-a', 'guid-1')).toBe(false);
  });

  it('supports a durable pause flag per server', () => {
    const storage = new RssStorage(':memory:');
    expect(storage.isPaused('server-a')).toBe(false);
    storage.setPaused('server-a', true);
    expect(storage.isPaused('server-a')).toBe(true);
  });
});
