import { describe, expect, it, vi } from 'vitest';
import { formatRssDigest, rssIntegrationHealth } from '../src/index.js';
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

  it('completes each non-digest post before a later delivery fails and retries only the unposted item', async () => {
    const storage = readyStorage();
    const delivery = deliveryStore(false);
    const policy = { evaluate: vi.fn().mockResolvedValue({ allowed: true }) };
    const publisher = {
      publish: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('gateway'))
        .mockResolvedValueOnce(undefined),
    };
    const scheduler = schedulerFor(
      storage,
      { fetch: vi.fn().mockResolvedValue([item('first'), item('second')]) },
      publisher,
      'server',
      policy,
      delivery,
    );

    await expect(scheduler.tick()).resolves.toBe(1);
    await expect(scheduler.tick()).resolves.toBe(1);

    expect(publisher.publish).toHaveBeenCalledTimes(3);
    expect(
      publisher.publish.mock.calls.map((call) => call[1].entries[0].id),
    ).toEqual(['first', 'second', 'second']);
    expect(delivery.completeDelivery).toHaveBeenCalledWith(
      'server',
      'rss',
      'https://news.example.com/feed.xml:first',
      'lease:https://news.example.com/feed.xml:first',
      expect.any(Date),
    );
    expect(delivery.releaseDelivery).toHaveBeenCalledWith(
      'server',
      'rss',
      'https://news.example.com/feed.xml:second',
      'lease:https://news.example.com/feed.xml:second',
      expect.any(Date),
      'network',
    );
    expect(policy.evaluate).toHaveBeenCalledTimes(5);
  });

  it('keeps every rendered digest entry complete within the payload bound', () => {
    const digest = formatRssDigest({
      entries: [
        {
          ...item('oversized'),
          sourceLabel: 's'.repeat(500),
          title: 't'.repeat(1_000),
          url: `https://news.example.com/${'u'.repeat(2_000)}`,
          publishedAt: 'p'.repeat(500),
        },
        { ...item('retained'), sourceLabel: 'News' },
      ],
    });

    expect(digest.length).toBeLessThanOrEqual(1_900);
    expect(digest).not.toContain('u'.repeat(500));
    expect(digest).toContain('**News** · Update retained');
    expect(digest).toContain('https://news.example.com/retained');
    expect(digest).toContain('2026-08-11T12:00:00Z');
  });

  it('reports configured RSS as unavailable until a scheduler exists', () => {
    expect(rssIntegrationHealth('', false)).toBe('not_configured');
    expect(rssIntegrationHealth('channel-1', false)).toBe('unavailable');
    expect(rssIntegrationHealth('channel-1', true)).toBe('ready');
  });
});

function schedulerFor(
  storage: object,
  client: object,
  publisher: object,
  serverId: string,
  policy: object = { evaluate: vi.fn().mockResolvedValue({ allowed: true }) },
  delivery = deliveryStore(),
): RssScheduler {
  return new RssScheduler(
    storage as never,
    client as never,
    publisher as never,
    serverId,
    'channel-1',
    policy as never,
    delivery as never,
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

function deliveryStore(digestMode = true) {
  const completed = new Set<string>();
  const claimed = new Set<string>();
  return {
    getPolicy: vi.fn().mockResolvedValue({ digestMode }),
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
