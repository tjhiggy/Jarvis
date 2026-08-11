import { describe, expect, it, vi } from 'vitest';
import { RssScheduler } from '../src/notifications/rss-scheduler.js';
import { RssStorage } from '../src/notifications/rss-storage.js';

describe('RssScheduler', () => {
  it('polls configured feeds and publishes only newly claimed items', async () => {
    const storage = {
      listFeeds: () => [
        {
          serverId: 's',
          url: 'https://news.example.com/feed.xml',
          label: 'News',
          paused: false,
          baselined: true,
        },
      ],
      isPaused: () => false,
      establishBaseline: vi.fn(),
      isBaselineItem: () => false,
      hasReachedDailyDeliveryLimit: () => false,
      recordCompletedItem: () => true,
    };
    const client = {
      fetch: vi
        .fn()
        .mockResolvedValue([
          { id: 'a', title: 'Update', url: 'https://news.example.com/a' },
        ]),
    };
    const publisher = { publish: vi.fn().mockResolvedValue(undefined) };
    const scheduler = schedulerFor(storage, client, publisher, 's');
    expect(await scheduler.tick()).toBe(1);
    expect(publisher.publish).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({
        entries: [expect.objectContaining({ id: 'a' })],
      }),
    );
  });

  it('baselines a new feed without publishing historical items', async () => {
    const storage = new RssStorage(':memory:');
    const url = 'https://news.example.com/feed.xml';
    storage.addFeed('server', url, 'Xbox News');
    const publisher = { publish: vi.fn().mockResolvedValue(undefined) };
    const scheduler = schedulerFor(
      storage,
      {
        fetch: vi.fn().mockResolvedValue([item('old-a'), item('old-b')]),
      },
      publisher,
      'server',
    );

    await expect(scheduler.tick()).resolves.toBe(0);
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(storage.listFeeds('server')[0]).toMatchObject({ baselined: true });
  });

  it('releases a failed Discord delivery so the next tick retries it', async () => {
    const storage = readyStorage();
    const publisher = {
      publish: vi.fn().mockRejectedValueOnce(new Error('gateway')),
    };
    const scheduler = schedulerFor(
      storage,
      { fetch: vi.fn().mockResolvedValue([item('retryable')]) },
      publisher,
      'server',
    );

    await expect(scheduler.tick()).resolves.toBe(0);
    publisher.publish.mockResolvedValue(undefined);
    await expect(scheduler.tick()).resolves.toBe(1);
    expect(publisher.publish).toHaveBeenCalledTimes(2);
  });

  it('publishes at most five new entries in one source-labelled digest', async () => {
    const storage = readyStorage();
    const publisher = { publish: vi.fn().mockResolvedValue(undefined) };
    const scheduler = schedulerFor(
      storage,
      {
        fetch: vi
          .fn()
          .mockResolvedValue(
            Array.from({ length: 7 }, (_, index) => item(`item-${index}`)),
          ),
      },
      publisher,
      'server',
    );

    await expect(scheduler.tick()).resolves.toBe(5);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(publisher.publish).toHaveBeenCalledWith(
      'channel-1',
      expect.objectContaining({
        entries: [
          expect.objectContaining({
            sourceLabel: 'News',
            title: 'Update item-0',
            url: 'https://news.example.com/item-0',
            publishedAt: '2026-08-11T12:00:00Z',
          }),
          expect.objectContaining({
            sourceLabel: 'News',
            title: 'Update item-1',
          }),
          expect.objectContaining({
            sourceLabel: 'News',
            title: 'Update item-2',
          }),
          expect.objectContaining({
            sourceLabel: 'News',
            title: 'Update item-3',
          }),
          expect.objectContaining({
            sourceLabel: 'News',
            title: 'Update item-4',
          }),
        ],
      }),
    );
  });

  it('suppresses entries after twenty completed RSS items on a UTC day', async () => {
    const storage = readyStorage();
    const publisher = { publish: vi.fn().mockResolvedValue(undefined) };
    const scheduler = schedulerFor(
      storage,
      {
        fetch: vi
          .fn()
          .mockResolvedValue(
            Array.from({ length: 25 }, (_, index) => item(`limit-${index}`)),
          ),
      },
      publisher,
      'server',
    );

    await expect(scheduler.tick()).resolves.toBe(5);
    await expect(scheduler.tick()).resolves.toBe(5);
    await expect(scheduler.tick()).resolves.toBe(5);
    await expect(scheduler.tick()).resolves.toBe(5);
    await expect(scheduler.tick()).resolves.toBe(0);
    expect(publisher.publish).toHaveBeenCalledTimes(4);
  });
});

function schedulerFor(
  storage: object,
  client: object,
  publisher: object,
  serverId: string,
): RssScheduler {
  return new RssScheduler(
    storage as never,
    client as never,
    publisher as never,
    serverId,
    'channel-1',
    {
      evaluate: vi.fn().mockResolvedValue({ allowed: true }),
    } as never,
    deliveryStore(),
    () => new Date('2026-08-11T12:00:00Z'),
  );
}

function readyStorage(): RssStorage {
  const storage = new RssStorage(':memory:');
  const url = 'https://news.example.com/feed.xml';
  storage.addFeed('server', url, 'News');
  storage.establishBaseline('server', url, []);
  return storage;
}

function deliveryStore() {
  const completed = new Set<string>();
  const claimed = new Set<string>();
  return {
    getPolicy: vi.fn().mockResolvedValue({ digestMode: true }),
    claimDelivery: vi
      .fn()
      .mockImplementation(async (_server, _category, key) => {
        if (completed.has(key) || claimed.has(key)) return undefined;
        claimed.add(key);
        return `lease:${key}`;
      }),
    completeDelivery: vi
      .fn()
      .mockImplementation(async (_server, _category, key) => {
        claimed.delete(key);
        completed.add(key);
        return true;
      }),
    releaseDelivery: vi
      .fn()
      .mockImplementation(async (_server, _category, key) => {
        claimed.delete(key);
        return true;
      }),
  };
}

function item(id: string) {
  return {
    id,
    title: `Update ${id}`,
    url: `https://news.example.com/${id}`,
    publishedAt: '2026-08-11T12:00:00Z',
  };
}
