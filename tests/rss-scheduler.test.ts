import { describe, expect, it, vi } from 'vitest';
import { RssScheduler } from '../src/notifications/rss-scheduler.js';

describe('RssScheduler', () => {
  it('polls configured feeds and publishes only newly claimed items', async () => {
    const storage = {
      listFeeds: () => [
        {
          serverId: 's',
          url: 'https://news.example.com/feed.xml',
          label: 'News',
          paused: false,
        },
      ],
      isPaused: () => false,
      claimItem: vi.fn().mockReturnValue(true),
    };
    const client = {
      fetch: vi
        .fn()
        .mockResolvedValue([
          { id: 'a', title: 'Update', url: 'https://news.example.com/a' },
        ]),
    };
    const publisher = { publish: vi.fn().mockResolvedValue(undefined) };
    const scheduler = new RssScheduler(
      storage,
      client,
      publisher,
      's',
      'channel-1',
    );
    expect(await scheduler.tick()).toBe(1);
    expect(publisher.publish).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({ id: 'a' }),
    );
  });
});
