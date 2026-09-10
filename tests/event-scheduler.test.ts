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
        claimDueEventReminders: async () => [
          {
            eventId: 'event-1',
            guildId: 'guild-1',
            channelId: 'events',
            userId: 'user-1',
            title: 'Secret title',
            scheduledAt: new Date(),
            leaseToken: 'lease-1',
          },
        ],
        markEventReminderDelivered: async () => true,
        markEventReminderFailed: async () => true,
        cleanup: async () => 0,
      } as any,
      gateway: {
        deliver: async () => {
          throw new Error('Secret RSVP reason');
        },
      },
      policy: allowPolicy(),
      broadcastStore: deliveryStore(),
      logger: { warn: (fields) => warnings.push(fields) },
    }).tick();
    expect(warnings).toEqual([
      expect.objectContaining({
        operation: 'event_reminder_delivery',
        guildId: 'guild-1',
        eventId: 'event-1',
        errorClass: 'Error',
      }),
    ]);
    expect(JSON.stringify(warnings)).not.toContain('Secret');
  });
  it('re-checks a persisted pause immediately before delivering a claimed reminder', async () => {
    const deliver = vi.fn();
    await new EventScheduler({
      repository: {
        claimDueEventReminders: async () => [
          {
            eventId: 'event-1',
            guildId: 'guild-1',
            channelId: 'events',
            userId: 'user-1',
            title: 'Raid',
            scheduledAt: new Date(),
            leaseToken: 'lease-1',
          },
        ],
        engagementPaused: async () => true,
        markEventReminderDelivered: async () => true,
        markEventReminderFailed: async () => true,
        cleanup: async () => 0,
      } as any,
      gateway: { deliver },
      policy: allowPolicy(),
      broadcastStore: deliveryStore(),
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
      policy: allowPolicy(),
      broadcastStore: deliveryStore(),
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
        createdAt: new Date('2026-08-08T11:59:00Z'),
        updatedAt: new Date('2026-08-08T11:59:00Z'),
      });
      const dependencies = {
        repository,
        gateway: {
          deliver: async () => {
            deliveries += 1;
          },
        },
        policy: allowPolicy(),
        broadcastStore: deliveryStore(),
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
        createdAt: new Date('2026-08-08T11:59:00Z'),
        updatedAt: new Date('2026-08-08T11:59:00Z'),
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

  it('releases the reminder claim when delivery is globally paused', async () => {
    const releaseEventReminder = vi.fn();
    const claimDelivery = vi.fn();
    const deliver = vi.fn();
    await new EventScheduler({
      repository: {
        claimDueEventReminders: async () => [dueReminder()],
        engagementPaused: async () => true,
        releaseEventReminder,
        markEventReminderDelivered: async () => true,
        markEventReminderFailed: async () => true,
      } as any,
      gateway: { deliver },
      policy: allowPolicy(),
      broadcastStore: {
        claimDelivery,
        completeDelivery: async () => true,
        releaseDelivery: async () => true,
      },
    }).tick();
    expect(deliver).not.toHaveBeenCalled();
    expect(claimDelivery).not.toHaveBeenCalled();
    expect(releaseEventReminder).toHaveBeenCalledWith(
      'event-1',
      'guild-1',
      'user-1',
      'lease-1',
      expect.any(Date),
    );
  });

  it('releases the reminder claim when broadcast policy denies delivery', async () => {
    const releaseEventReminder = vi.fn();
    const claimDelivery = vi.fn();
    await new EventScheduler({
      repository: {
        claimDueEventReminders: async () => [dueReminder()],
        engagementPaused: async () => false,
        releaseEventReminder,
        markEventReminderDelivered: async () => true,
        markEventReminderFailed: async () => true,
      } as any,
      gateway: { deliver: vi.fn() },
      policy: {
        evaluate: async () => ({
          allowed: false as const,
          reason: 'globally_paused' as const,
        }),
      },
      broadcastStore: {
        claimDelivery,
        completeDelivery: async () => true,
        releaseDelivery: async () => true,
      },
    }).tick();
    expect(claimDelivery).not.toHaveBeenCalled();
    expect(releaseEventReminder).toHaveBeenCalledOnce();
  });

  it('releases both leases when policy flips to deny after the broadcast claim', async () => {
    const releaseEventReminder = vi.fn();
    const releaseDelivery = vi.fn();
    const deliver = vi.fn();
    let evaluations = 0;
    await new EventScheduler({
      repository: {
        claimDueEventReminders: async () => [dueReminder()],
        engagementPaused: async () => false,
        releaseEventReminder,
        markEventReminderDelivered: async () => true,
        markEventReminderFailed: async () => true,
      } as any,
      gateway: { deliver },
      policy: {
        evaluate: async () => {
          evaluations += 1;
          return evaluations === 1
            ? { allowed: true as const }
            : {
                allowed: false as const,
                reason: 'globally_paused' as const,
              };
        },
      },
      broadcastStore: {
        claimDelivery: async () => 'broadcast-lease',
        completeDelivery: async () => true,
        releaseDelivery,
      },
    }).tick();
    expect(deliver).not.toHaveBeenCalled();
    expect(releaseDelivery).toHaveBeenCalledWith(
      'guild-1',
      'event_reminder',
      'event_reminder:event-1:user-1',
      'broadcast-lease',
      expect.any(Date),
    );
    expect(releaseEventReminder).toHaveBeenCalledOnce();
  });

  it('releases the reminder claim when the broadcast delivery lease is lost', async () => {
    const releaseEventReminder = vi.fn();
    const deliver = vi.fn();
    await new EventScheduler({
      repository: {
        claimDueEventReminders: async () => [dueReminder()],
        engagementPaused: async () => false,
        releaseEventReminder,
        markEventReminderDelivered: async () => true,
        markEventReminderFailed: async () => true,
      } as any,
      gateway: { deliver },
      policy: allowPolicy(),
      broadcastStore: {
        claimDelivery: async () => undefined,
        completeDelivery: async () => true,
        releaseDelivery: async () => true,
      },
    }).tick();
    expect(deliver).not.toHaveBeenCalled();
    expect(releaseEventReminder).toHaveBeenCalledOnce();
  });

  it('marks a reminder failed without delivering after the retry grace window', async () => {
    const scheduledAt = new Date('2026-08-08T11:44:00.000Z');
    const tickAt = new Date('2026-08-08T12:00:00.000Z');
    const releaseDelivery = vi.fn();
    const markEventReminderFailed = vi.fn();
    const deliver = vi.fn();
    await new EventScheduler({
      repository: {
        claimDueEventReminders: async () => [dueReminder({ scheduledAt })],
        engagementPaused: async () => false,
        markEventReminderDelivered: async () => true,
        markEventReminderFailed,
      } as any,
      gateway: { deliver },
      policy: allowPolicy(),
      broadcastStore: {
        claimDelivery: async () => 'broadcast-lease',
        completeDelivery: async () => true,
        releaseDelivery,
      },
      now: () => tickAt,
    }).tick();
    expect(deliver).not.toHaveBeenCalled();
    expect(releaseDelivery).toHaveBeenCalledOnce();
    expect(markEventReminderFailed).toHaveBeenCalledWith(
      'event-1',
      'guild-1',
      'user-1',
      'lease-1',
      tickAt,
    );
  });

  it('does not mark delivered when completeDelivery returns false', async () => {
    const markEventReminderDelivered = vi.fn();
    const releaseEventReminder = vi.fn();
    const releaseDelivery = vi.fn();
    await new EventScheduler({
      repository: {
        claimDueEventReminders: async () => [dueReminder()],
        engagementPaused: async () => false,
        releaseEventReminder,
        markEventReminderDelivered,
        markEventReminderFailed: async () => true,
      } as any,
      gateway: { deliver: async () => undefined },
      policy: allowPolicy(),
      broadcastStore: {
        claimDelivery: async () => 'broadcast-lease',
        completeDelivery: async () => false,
        releaseDelivery,
      },
      now: () => new Date('2026-08-08T12:00:00.000Z'),
    }).tick();
    expect(markEventReminderDelivered).not.toHaveBeenCalled();
    expect(releaseDelivery).toHaveBeenCalledOnce();
    expect(releaseEventReminder).toHaveBeenCalledOnce();
  });

  it('shares one in-flight tick so overlapping runs cannot double-claim', async () => {
    let releaseHold: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    let claims = 0;
    const scheduler = new EventScheduler({
      repository: {
        claimDueEventReminders: async () => {
          claims += 1;
          await hold;
          return [];
        },
        markEventReminderDelivered: async () => true,
        markEventReminderFailed: async () => true,
      } as any,
      gateway: { deliver: async () => undefined },
      policy: allowPolicy(),
      broadcastStore: deliveryStore(),
    });
    const first = scheduler.tick();
    const second = scheduler.tick();
    await Promise.resolve();
    expect(claims).toBe(1);
    releaseHold();
    await Promise.all([first, second]);
    expect(claims).toBe(1);
  });

  it('closes due events after reminder processing so they become cleanup-eligible', async () => {
    const calls: string[] = [];
    await new EventScheduler({
      repository: {
        claimDueEventReminders: async () => [],
        closeDueEvents: async () => {
          calls.push('close');
          return 2;
        },
        markEventReminderDelivered: async () => true,
        markEventReminderFailed: async () => true,
      } as any,
      gateway: { deliver: async () => undefined },
      policy: allowPolicy(),
      broadcastStore: deliveryStore(),
      now: () => new Date('2026-08-08T12:00:00.000Z'),
    }).tick();
    expect(calls).toEqual(['close']);
  });
});

function dueReminder(
  overrides: Partial<{
    eventId: string;
    guildId: string;
    channelId: string;
    userId: string;
    title: string;
    scheduledAt: Date;
    leaseToken: string;
  }> = {},
) {
  return {
    eventId: 'event-1',
    guildId: 'guild-1',
    channelId: 'events',
    userId: 'user-1',
    title: 'Raid',
    scheduledAt: new Date('2026-08-08T12:00:00.000Z'),
    leaseToken: 'lease-1',
    ...overrides,
  };
}

const allowPolicy = () => ({
  evaluate: async () => ({ allowed: true as const }),
});

const deliveryStore = () => ({
  claimDelivery: async () => 'broadcast-lease',
  completeDelivery: async () => true,
  releaseDelivery: async () => true,
});
