import { describe, expect, it } from 'vitest';
import { ScheduledNotificationService, type ScheduledNotificationStore, type ScheduledNotificationPublisher } from '../src/notifications/scheduled-notification.js';

describe('ScheduledNotificationService', () => {
  it('claims and publishes each item once', async () => {
    const seen = new Set<string>(); const published: string[] = [];
    const store: ScheduledNotificationStore = { isPaused: async () => false, claim: async (key) => !seen.has(key) && (seen.add(key), true) };
    const publisher: ScheduledNotificationPublisher = { publish: async (_channel, item) => { published.push(item.id); } };
    const service = new ScheduledNotificationService(store, publisher, 'channel-1');
    expect(await service.publish([{ id: 'a', title: 'A', url: 'https://example.com/a' }, { id: 'a', title: 'A', url: 'https://example.com/a' }])).toBe(1);
    expect(published).toEqual(['a']);
  });
});
