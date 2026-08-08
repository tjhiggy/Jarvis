import { describe, expect, it, vi } from 'vitest';
import { EventScheduler } from '../src/engagement/event-scheduler.js';

describe('event scheduler', () => {
  it('recovers after restart and only delivers opted-in reminders without mentions', async () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const scheduler = new EventScheduler({
      repository: {
        claimDueEventReminders: async () => [
          {
            eventId: 'event-1',
            guildId: 'guild-1',
            channelId: 'events',
            userId: 'user-1',
            title: 'Raid',
            scheduledAt: new Date('2026-08-08T12:30:00Z'),
          },
        ],
        markEventReminderDelivered: async () => true,
        markEventReminderFailed: async () => true,
        cleanup: async () => 0,
      } as any,
      gateway: { deliver },
      now: () => new Date('2026-08-08T12:00:00Z'),
    });
    await scheduler.tick();
    expect(deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        allowedMentions: { parse: [], repliedUser: false },
      }),
    );
  });
});
