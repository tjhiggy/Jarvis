import { describe, expect, it, vi } from 'vitest';
import { EventScheduler } from '../src/engagement/event-scheduler.js';
import { SQLiteEngagementRepository } from '../src/storage/engagement-sqlite.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('event scheduler', () => {
  it('logs a content-free operational failure before marking a reminder failed', async () => {
    const warnings: Array<Record<string, string | number>> = [];
    await new EventScheduler({
      repository: {
        claimDueEventReminders: async () => [{ eventId: 'event-1', guildId: 'guild-1', channelId: 'events', userId: 'user-1', title: 'Secret title', scheduledAt: new Date(), leaseToken: 'lease-1' }],
        markEventReminderDelivered: async () => true,
        markEventReminderFailed: async () => true,
        cleanup: async () => 0,
      } as any,
      gateway: { deliver: async () => { throw new Error('Secret RSVP reason'); } },
      logger: { warn: (fields) => warnings.push(fields) },
    }).tick();
    expect(warnings).toEqual([expect.objectContaining({ operation: 'event_reminder_delivery', guildId: 'guild-1', eventId: 'event-1', errorClass: 'Error' })]);
    expect(JSON.stringify(warnings)).not.toContain('Secret');
  });
  it('re-checks a persisted pause immediately before delivering a claimed reminder', async () => {
    const deliver = vi.fn();
    await new EventScheduler({
      repository: {
        claimDueEventReminders: async () => [{ eventId: 'event-1', guildId: 'guild-1', channelId: 'events', userId: 'user-1', title: 'Raid', scheduledAt: new Date(), leaseToken: 'lease-1' }],
        engagementPaused: async () => true,
        markEventReminderDelivered: async () => true,
        markEventReminderFailed: async () => true,
        cleanup: async () => 0,
      } as any,
      gateway: { deliver },
    }).tick();
    expect(deliver).not.toHaveBeenCalled();
  });
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

  it('does not double-deliver when two scheduler ticks claim the same due RSVP', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-event-lease-'));
    const repository = new SQLiteEngagementRepository(
      join(directory, 'events.db'),
    );
    const now = new Date('2026-08-08T12:00:00Z');
    let deliveries = 0;
    try {
      await repository.createEvent({
        id: 'event-1',
        guildId: 'guild-1',
        channelId: 'events',
        ownerUserId: 'owner',
        title: 'Raid',
        description: 'Boarding party',
        scheduledAt: now,
        timezone: 'UTC',
        capacity: 1,
        status: 'scheduled',
        createdAt: now,
        updatedAt: now,
      });
      await repository.respondToEvent({
        eventId: 'event-1',
        guildId: 'guild-1',
        userId: 'user-1',
        response: 'yes',
        attendance: 'none',
        reminderOptIn: true,
        createdAt: now,
        updatedAt: now,
      });
      const dependencies = {
        repository,
        gateway: {
          deliver: async () => {
            deliveries += 1;
          },
        },
        now: () => now,
      };
      await Promise.all([
        new EventScheduler(dependencies).tick(),
        new EventScheduler(dependencies).tick(),
      ]);
      expect(deliveries).toBe(1);
    } finally {
      await repository.closeConnection();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fences a stale worker after its lease is reclaimed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-event-fence-'));
    const repository = new SQLiteEngagementRepository(
      join(directory, 'events.db'),
    );
    const startedAt = new Date('2026-08-08T12:00:00Z');
    try {
      await repository.createEvent({
        id: 'event-fence',
        guildId: 'guild-1',
        channelId: 'events',
        ownerUserId: 'owner',
        title: 'Raid',
        description: 'Boarding party',
        scheduledAt: startedAt,
        timezone: 'UTC',
        capacity: 1,
        status: 'scheduled',
        createdAt: startedAt,
        updatedAt: startedAt,
      });
      await repository.respondToEvent({
        eventId: 'event-fence',
        guildId: 'guild-1',
        userId: 'user-1',
        response: 'yes',
        attendance: 'none',
        reminderOptIn: true,
        createdAt: startedAt,
        updatedAt: startedAt,
      });
      const first = (await repository.claimDueEventReminders(startedAt, 1))[0]!;
      const reclaimed = (
        await repository.claimDueEventReminders(
          new Date('2026-08-08T12:06:00Z'),
          1,
        )
      )[0]!;
      expect(reclaimed.leaseToken).not.toBe(first.leaseToken);
      await expect(
        repository.markEventReminderDelivered(
          first.eventId,
          first.guildId,
          first.userId,
          first.leaseToken,
          new Date('2026-08-08T12:06:00Z'),
        ),
      ).resolves.toBe(false);
      await expect(
        repository.markEventReminderDelivered(
          reclaimed.eventId,
          reclaimed.guildId,
          reclaimed.userId,
          reclaimed.leaseToken,
          new Date('2026-08-08T12:06:00Z'),
        ),
      ).resolves.toBe(true);
    } finally {
      await repository.closeConnection();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
