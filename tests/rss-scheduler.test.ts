import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { formatRssDigest, rssIntegrationHealth } from '../src/index.js';
import {
  renderRssDigest,
  rssBroadcastSendPayload,
  rssBroadcastShowsItem,
  RssScheduler,
} from '../src/notifications/rss-scheduler.js';
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
      remainingDailyDeliveryCapacity: () => 20,
      reserveDailyDelivery: () => true,
      completeDailyDelivery: () => true,
      releaseDailyDelivery: () => true,
      rolloverDailyDeliveryReservation: () => true,
    };
    const client = {
      fetch: vi.fn().mockResolvedValue([
        {
          id: 'a',
          title: 'Update',
          url: 'https://news.example.com/a',
          publishedAt: '2026-08-11T12:00:00Z',
        },
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
    expect(publisher.publish).toHaveBeenCalledTimes(5);
    expect(publisher.publish.mock.calls.map((call) => call[1].entries)).toEqual(
      [
        [
          expect.objectContaining({
            sourceLabel: 'News',
            title: 'Update item-0',
            url: 'https://news.example.com/item-0',
            publishedAt: '2026-08-11T12:00:00Z',
          }),
        ],
        [
          expect.objectContaining({
            sourceLabel: 'News',
            title: 'Update item-1',
          }),
        ],
        [
          expect.objectContaining({
            sourceLabel: 'News',
            title: 'Update item-2',
          }),
        ],
        [
          expect.objectContaining({
            sourceLabel: 'News',
            title: 'Update item-3',
          }),
        ],
        [
          expect.objectContaining({
            sourceLabel: 'News',
            title: 'Update item-4',
          }),
        ],
      ],
    );
  });

  it('does not start a new tick after stop', async () => {
    const storage = readyStorage();
    const client = { fetch: vi.fn().mockResolvedValue([item('after-stop')]) };
    const scheduler = schedulerFor(
      storage,
      client,
      { publish: vi.fn().mockResolvedValue(undefined) },
      'server',
    );

    await scheduler.stop();
    await expect(scheduler.tick()).resolves.toBe(0);
    expect(client.fetch).not.toHaveBeenCalled();
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
    expect(publisher.publish).toHaveBeenCalledTimes(20);
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

  it('rechecks policy after non-digest reservation rollover before posting', async () => {
    const storage = readyStorage();
    let denied = false;
    const rollover = vi.spyOn(storage, 'rolloverDailyDeliveryReservation');
    rollover.mockImplementation(() => {
      denied = true;
      return true;
    });
    const policy = {
      evaluate: vi.fn().mockImplementation(async () => ({ allowed: !denied })),
    };
    const delivery = deliveryStore(false);
    const publisher = { publish: vi.fn().mockResolvedValue(undefined) };
    const scheduler = schedulerFor(
      storage,
      { fetch: vi.fn().mockResolvedValue([item('policy-race')]) },
      publisher,
      'server',
      policy,
      delivery,
    );

    await expect(scheduler.tick()).resolves.toBe(0);

    expect(publisher.publish).not.toHaveBeenCalled();
    expect(delivery.completeDelivery).not.toHaveBeenCalled();
    expect(delivery.releaseDelivery).toHaveBeenCalledWith(
      'server',
      'rss',
      'https://news.example.com/feed.xml:policy-race',
      'lease:https://news.example.com/feed.xml:policy-race',
      expect.any(Date),
      undefined,
    );
  });

  it('rechecks policy after digest reservation rollover and rendering before posting', async () => {
    const storage = readyStorage();
    let denied = false;
    const rollover = vi.spyOn(storage, 'rolloverDailyDeliveryReservation');
    rollover.mockImplementation(() => {
      denied = true;
      return true;
    });
    const policy = {
      evaluate: vi.fn().mockImplementation(async () => ({ allowed: !denied })),
    };
    const delivery = deliveryStore(true);
    const publisher = { publish: vi.fn().mockResolvedValue(undefined) };
    const scheduler = schedulerFor(
      storage,
      { fetch: vi.fn().mockResolvedValue([item('digest-policy-race')]) },
      publisher,
      'server',
      policy,
      delivery,
    );

    await expect(scheduler.tick()).resolves.toBe(0);

    expect(publisher.publish).not.toHaveBeenCalled();
    expect(delivery.completeDelivery).not.toHaveBeenCalled();
    expect(delivery.releaseDelivery).toHaveBeenCalledWith(
      'server',
      'rss',
      'https://news.example.com/feed.xml:digest-policy-race',
      'lease:https://news.example.com/feed.xml:digest-policy-race',
      expect.any(Date),
      undefined,
    );
  });

  it('refuses to send an RSS payload without a visible title and link', () => {
    expect(() =>
      rssBroadcastSendPayload({
        title: '   ',
        url: '',
        sourceLabel: 'IGN',
      }),
    ).toThrow('RSS payload has no visible title and link.');
  });

  it('rejects empty content when SuppressEmbeds would hide the only RSS card', () => {
    const item = {
      title: 'Update gta-apartment',
      url: 'https://news.example.com/gta-apartment',
    };
    const blankCard = {
      embeds: [
        {
          title: item.title,
          url: item.url,
          author: { name: 'IGN' },
        },
      ],
      allowedMentions: { parse: [], repliedUser: false },
      flags: MessageFlags.SuppressEmbeds,
    };

    expect(rssBroadcastShowsItem(blankCard, item)).toBe(false);
    expect(rssBroadcastShowsItem({ ...blankCard, content: '' }, item)).toBe(
      false,
    );
    expect(
      rssBroadcastShowsItem(
        { content: item.title, flags: MessageFlags.SuppressEmbeds },
        item,
      ),
    ).toBe(false);
    expect(
      rssBroadcastShowsItem(
        { embeds: [{ title: item.title, url: item.url }] },
        item,
      ),
    ).toBe(true);
  });

  it('sends title and link in content so SuppressEmbeds cannot blank the RSS post', () => {
    const digest = renderRssDigest({
      entries: [
        {
          ...item('gta-apartment', {
            imageUrl: 'https://cdn.example.com/gta-apartment.jpg',
          }),
          sourceLabel: 'IGN',
          deliveryKey: 'ign:gta-apartment',
        },
        {
          ...item('elden-ring'),
          sourceLabel: 'PC Gamer',
          deliveryKey: 'pcgamer:elden-ring',
        },
      ],
    });

    const payloads = digest.entries.map((entry) =>
      rssBroadcastSendPayload(entry),
    );

    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toEqual({
      content:
        '**IGN** · Update gta-apartment\nhttps://news.example.com/gta-apartment\n2026-08-11T12:00:00Z',
      embeds: [
        {
          title: 'Update gta-apartment',
          url: 'https://news.example.com/gta-apartment',
          author: { name: 'IGN' },
          image: { url: 'https://cdn.example.com/gta-apartment.jpg' },
        },
      ],
      allowedMentions: { parse: [], repliedUser: false },
      flags: MessageFlags.SuppressEmbeds,
    });
    expect(payloads[1]).toEqual({
      content:
        '**PC Gamer** · Update elden-ring\nhttps://news.example.com/elden-ring\n2026-08-11T12:00:00Z',
      embeds: [
        {
          title: 'Update elden-ring',
          url: 'https://news.example.com/elden-ring',
          author: { name: 'PC Gamer' },
        },
      ],
      allowedMentions: { parse: [], repliedUser: false },
      flags: MessageFlags.SuppressEmbeds,
    });
    expect(payloads[1]!.embeds[0]).not.toHaveProperty('image');
    expect(
      rssBroadcastShowsItem(payloads[0]!, {
        title: 'Update gta-apartment',
        url: 'https://news.example.com/gta-apartment',
      }),
    ).toBe(true);
    expect(
      rssBroadcastShowsItem(payloads[1]!, {
        title: 'Update elden-ring',
        url: 'https://news.example.com/elden-ring',
      }),
    ).toBe(true);
  });

  it('keeps every rendered digest entry complete within the payload bound', () => {
    const digest = renderRssDigest({
      entries: [
        {
          ...item('oversized'),
          deliveryKey: 'oversized',
          sourceLabel: 's'.repeat(500),
          title: 't'.repeat(1_000),
          url: `https://news.example.com/${'u'.repeat(2_000)}`,
          publishedAt: 'p'.repeat(500),
        },
        { ...item('retained'), deliveryKey: 'retained', sourceLabel: 'News' },
      ],
    });
    const payloads = digest.entries.map((entry) =>
      rssBroadcastSendPayload(entry),
    );

    expect(digest.entries.map((entry) => entry.id)).toEqual(['retained']);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      content:
        '**News** · Update retained\nhttps://news.example.com/retained\n2026-08-11T12:00:00Z',
      embeds: [
        {
          title: 'Update retained',
          url: 'https://news.example.com/retained',
          author: { name: 'News' },
        },
      ],
      flags: MessageFlags.SuppressEmbeds,
    });
    expect(
      rssBroadcastShowsItem(payloads[0]!, {
        title: 'Update retained',
        url: 'https://news.example.com/retained',
      }),
    ).toBe(true);
    expect(JSON.stringify(payloads)).not.toContain('u'.repeat(500));
    expect(formatRssDigest(digest)).not.toContain('u'.repeat(500));
  });

  it('reports configured RSS as unavailable until a scheduler exists', () => {
    expect(rssIntegrationHealth('', false)).toBe('not_configured');
    expect(rssIntegrationHealth('channel-1', false)).toBe('unavailable');
    expect(rssIntegrationHealth('channel-1', true)).toBe('ready');
  });

  it('omits empty-title headlines so a later visible item can still post', async () => {
    const storage = readyStorage();
    const delivery = deliveryStore(true);
    const publisher = { publish: vi.fn().mockResolvedValue(undefined) };
    const scheduler = schedulerFor(
      storage,
      {
        fetch: vi.fn().mockResolvedValue([
          {
            ...item('blank-title'),
            title: '   ',
          },
          item('visible'),
        ]),
      },
      publisher,
      'server',
      undefined,
      delivery,
    );

    await expect(scheduler.tick()).resolves.toBe(1);

    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(publisher.publish.mock.calls[0]?.[1].entries[0]).toMatchObject({
      id: 'visible',
    });
    expect(delivery.completeDelivery).toHaveBeenCalledWith(
      'server',
      'rss',
      'https://news.example.com/feed.xml:visible',
      'lease:https://news.example.com/feed.xml:visible',
      expect.any(Date),
    );
    expect(delivery.completeDelivery).not.toHaveBeenCalledWith(
      'server',
      'rss',
      'https://news.example.com/feed.xml:blank-title',
      expect.anything(),
      expect.any(Date),
    );
    expect(delivery.releaseDelivery).toHaveBeenCalledWith(
      'server',
      'rss',
      'https://news.example.com/feed.xml:blank-title',
      'lease:https://news.example.com/feed.xml:blank-title',
      expect.any(Date),
      undefined,
    );
    expect(delivery.releaseDelivery).not.toHaveBeenCalledWith(
      'server',
      'rss',
      'https://news.example.com/feed.xml:visible',
      expect.anything(),
      expect.any(Date),
      'network',
    );
  });

  it('releases digest claims omitted by rendering instead of completing them', async () => {
    const storage = readyStorage();
    const delivery = deliveryStore(true);
    const publisher = { publish: vi.fn().mockResolvedValue(undefined) };
    const scheduler = schedulerFor(
      storage,
      {
        fetch: vi.fn().mockResolvedValue([
          item('delivered'),
          {
            ...item('too-large'),
            url: `https://news.example.com/${'u'.repeat(500)}`,
          },
        ]),
      },
      publisher,
      'server',
      undefined,
      delivery,
    );

    await expect(scheduler.tick()).resolves.toBe(1);

    expect(delivery.completeDelivery).toHaveBeenCalledWith(
      'server',
      'rss',
      'https://news.example.com/feed.xml:delivered',
      'lease:https://news.example.com/feed.xml:delivered',
      expect.any(Date),
    );
    expect(delivery.completeDelivery).not.toHaveBeenCalledWith(
      'server',
      'rss',
      'https://news.example.com/feed.xml:too-large',
      expect.anything(),
      expect.any(Date),
    );
    expect(delivery.releaseDelivery).toHaveBeenCalledWith(
      'server',
      'rss',
      'https://news.example.com/feed.xml:too-large',
      'lease:https://news.example.com/feed.xml:too-large',
      expect.any(Date),
      undefined,
    );
  });

  it('reserves only the two remaining daily RSS delivery slots before posting', async () => {
    const storage = readyStorage();
    const now = new Date('2026-08-11T12:00:00Z');
    for (let index = 0; index < 18; index += 1) {
      expect(
        storage.recordCompletedItem('server', `completed-${index}`, now),
      ).toBe(true);
    }
    const delivery = deliveryStore(true);
    const publisher = { publish: vi.fn().mockResolvedValue(undefined) };
    const scheduler = schedulerFor(
      storage,
      {
        fetch: vi
          .fn()
          .mockResolvedValue([item('slot-1'), item('slot-2'), item('slot-3')]),
      },
      publisher,
      'server',
      undefined,
      delivery,
    );

    await expect(scheduler.tick()).resolves.toBe(2);

    expect(delivery.claimDelivery).toHaveBeenCalledTimes(2);
    expect(publisher.publish).toHaveBeenCalledTimes(2);
    expect(
      publisher.publish.mock.calls.map((call) =>
        call[1].entries.map((entry: { id: string }) => entry.id),
      ),
    ).toEqual([['slot-1'], ['slot-2']]);
  });

  it('re-reserves pre-midnight claims against the actual post day before sending', async () => {
    const storage = readyStorage();
    const beforeMidnight = new Date('2026-08-11T23:59:59.900Z');
    const afterMidnight = new Date('2026-08-12T00:00:01.000Z');
    let nowCalls = 0;
    let rolloverCount = 0;
    const originalRollover =
      storage.rolloverDailyDeliveryReservation.bind(storage);
    vi.spyOn(storage, 'rolloverDailyDeliveryReservation').mockImplementation(
      (...args) => {
        if (rolloverCount === 0) {
          for (let index = 0; index < 20; index += 1) {
            storage.recordCompletedItem(
              'server',
              `after-midnight-${index}`,
              afterMidnight,
            );
          }
        }
        rolloverCount += 1;
        return originalRollover(...args);
      },
    );
    const policy = { evaluate: vi.fn().mockResolvedValue({ allowed: true }) };
    const delivery = deliveryStore(true);
    const publisher = { publish: vi.fn().mockResolvedValue(undefined) };
    const scheduler = schedulerFor(
      storage,
      {
        fetch: vi
          .fn()
          .mockResolvedValue(
            Array.from({ length: 5 }, (_, index) => item(`midnight-${index}`)),
          ),
      },
      publisher,
      'server',
      policy,
      delivery,
      () => {
        nowCalls += 1;
        return nowCalls === 1 ? beforeMidnight : afterMidnight;
      },
    );

    await expect(scheduler.tick()).resolves.toBe(0);

    expect(publisher.publish).not.toHaveBeenCalled();
    expect(delivery.completeDelivery).not.toHaveBeenCalled();
    expect(delivery.releaseDelivery).toHaveBeenCalledTimes(5);
  });
  it('safe-logs an interval tick failure instead of leaking a rejected callback', async () => {
    let interval: (() => void) | undefined;
    const warnings: Array<Record<string, string>> = [];
    const setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation(((
      callback: () => void,
    ) => {
      interval = callback;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    const clearIntervalSpy = vi
      .spyOn(global, 'clearInterval')
      .mockImplementation(() => undefined);
    try {
      const scheduler = new RssScheduler(
        readyStorage(),
        { fetch: async () => [] },
        { publish: async () => undefined },
        'server',
        'channel-1',
        { evaluate: async () => Promise.reject(new Error('secret feed text')) },
        deliveryStore(),
        () => new Date(),
        { warn: (fields) => warnings.push(fields) },
      );

      scheduler.start();
      interval?.();
      await new Promise(setImmediate);

      expect(warnings).toEqual([
        expect.objectContaining({
          operation: 'rss_tick',
          errorClass: 'Error',
        }),
      ]);
      expect(JSON.stringify(warnings)).not.toContain('secret feed text');
      await scheduler.stop();
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });
});

function schedulerFor(
  storage: object,
  client: object,
  publisher: object,
  serverId: string,
  policy: object = { evaluate: vi.fn().mockResolvedValue({ allowed: true }) },
  delivery = deliveryStore(),
  now: () => Date = () => new Date('2026-08-11T12:00:00Z'),
): RssScheduler {
  return new RssScheduler(
    storage as never,
    client as never,
    publisher as never,
    serverId,
    'channel-1',
    policy as never,
    delivery as never,
    now,
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

function item(id: string, extras: { readonly imageUrl?: string } = {}) {
  return {
    id,
    title: `Update ${id}`,
    url: `https://news.example.com/${id}`,
    publishedAt: '2026-08-11T12:00:00Z',
    ...extras,
  };
}
