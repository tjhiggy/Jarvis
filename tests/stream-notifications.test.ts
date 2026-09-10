import { describe, expect, it, vi } from 'vitest';
import {
  StreamNotificationError,
  StreamNotificationService,
  type StreamNotificationClient,
  type StreamNotificationStore,
  type StreamNotificationPublisher,
} from '../src/notifications/stream-notifications.js';

const setup = (
  items = [
    {
      id: 'abc',
      provider: 'youtube' as const,
      title: 'Launch',
      url: 'https://youtube.com/watch?v=abc',
      publishedAt: '2026-08-09T00:00:00Z',
    },
  ],
) => {
  const client: StreamNotificationClient = {
    fetch: vi.fn().mockResolvedValue(items),
  };
  const keys = new Set<string>();
  const store: StreamNotificationStore = {
    seen: vi.fn(async (key) => keys.has(key)),
    markSeen: vi.fn(async (key) => {
      keys.add(key);
    }),
  };
  const publisher: StreamNotificationPublisher = {
    publish: vi.fn().mockResolvedValue(undefined),
  };
  return {
    service: new StreamNotificationService(client, store, publisher, 'channel'),
    client,
    store,
    publisher,
  };
};

describe('StreamNotificationService', () => {
  it('publishes new notifications and is idempotent', async () => {
    const { service, publisher } = setup();
    expect(
      await service.poll([
        { provider: 'youtube', id: 'channel', label: 'Crew' },
      ]),
    ).toBe(1);
    expect(
      await service.poll([
        { provider: 'youtube', id: 'channel', label: 'Crew' },
      ]),
    ).toBe(0);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
  });
  it('does nothing without a configured destination', async () => {
    const { publisher } = setup();
    const service = new StreamNotificationService(
      { fetch: vi.fn() },
      { seen: vi.fn(), markSeen: vi.fn() },
      publisher,
      '',
    );
    expect(
      await service.poll([{ provider: 'youtube', id: 'x', label: 'x' }]),
    ).toBe(0);
    expect(publisher.publish).not.toHaveBeenCalled();
  });
  it('continues to later feeds when one fetch throws or is not configured', async () => {
    const client: StreamNotificationClient = {
      fetch: vi
        .fn()
        .mockRejectedValueOnce(
          new StreamNotificationError(
            'not-configured',
            'Twitch notifications require optional API credentials.',
          ),
        )
        .mockRejectedValueOnce(new Error('YouTube timeout'))
        .mockResolvedValueOnce([
          {
            id: 'live-1',
            provider: 'youtube' as const,
            title: 'Later feed',
            url: 'https://youtube.com/watch?v=live-1',
            publishedAt: '2026-08-09T00:00:00Z',
          },
        ]),
    };
    const keys = new Set<string>();
    const publisher: StreamNotificationPublisher = {
      publish: vi.fn().mockResolvedValue(undefined),
    };
    const service = new StreamNotificationService(
      client,
      {
        seen: async (key) => keys.has(key),
        markSeen: async (key) => {
          keys.add(key);
        },
      },
      publisher,
      'channel',
    );
    expect(
      await service.poll([
        { provider: 'twitch', id: 'crew', label: 'Crew' },
        { provider: 'youtube', id: 'broken', label: 'Broken' },
        { provider: 'youtube', id: 'ok', label: 'OK' },
      ]),
    ).toBe(1);
    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(client.fetch).toHaveBeenCalledTimes(3);
  });

  it('bounds feeds and items per poll', async () => {
    const { service, client } = setup([]);
    await service.poll(
      Array.from({ length: 30 }, (_, i) => ({
        provider: 'youtube' as const,
        id: String(i),
        label: 'x',
      })),
    );
    expect(client.fetch).toHaveBeenCalledTimes(20);
  });
});
