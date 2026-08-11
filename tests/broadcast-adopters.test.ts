import { describe, expect, it, vi } from 'vitest';
import { RecapScheduler, RecapService } from '../src/engagement/recap.js';
import {
  EventScheduler,
  eventReminderRetryGraceMs,
} from '../src/engagement/event-scheduler.js';
import { BirthdayScheduler } from '../src/engagement/birthdays.js';
import { BroadcastPolicyService } from '../src/notifications/broadcast-policy.js';
import { SqliteBroadcastStore } from '../src/notifications/sqlite-broadcast-store.js';
import { SQLiteEngagementRepository } from '../src/storage/engagement-sqlite.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const now = new Date('2026-08-10T12:00:00.000Z');
const allowThenPause = () => ({
  evaluate: vi
    .fn()
    .mockResolvedValueOnce({ allowed: true })
    .mockResolvedValueOnce({ allowed: false, reason: 'globally_paused' }),
});

describe('scheduled broadcast policy adopters', () => {
  it('rechecks policy immediately before recap delivery when a pause lands after preparation', async () => {
    const post = vi.fn();
    const policy = allowThenPause();
    const scheduler = new RecapScheduler({
      guildId: 'server-1',
      channelId: 'recaps',
      schedule: 'MONDAY 12:00',
      timezone: 'UTC',
      repository: {
        recapEnabled: async () => true,
        claimRecapRun: async () => 'recap-lease',
        completeRecapRun: async () => true,
        releaseRecapRun: async () => true,
      } as any,
      service: new RecapService({
        repository: {
          recapSource: async () => ({
            guildId: 'server-1',
            introductions: 3,
            suggestions: 0,
            events: 0,
            participantUserIds: [],
            botActivity: 0,
          }),
        },
      }),
      gateway: { post },
      policy,
      broadcastStore: deliveryStore(),
      now: () => now,
    });

    await scheduler.tick();

    expect(post).not.toHaveBeenCalled();
    expect(policy.evaluate).toHaveBeenCalledTimes(2);
  });

  it('rechecks policy immediately before event reminder delivery when a pause lands after preparation', async () => {
    const deliver = vi.fn();
    const policy = allowThenPause();
    await new EventScheduler({
      repository: {
        claimDueEventReminders: async () => [
          {
            eventId: 'event-1',
            guildId: 'server-1',
            channelId: 'events',
            userId: 'crew-1',
            title: 'Boarding',
            scheduledAt: now,
            leaseToken: 'event-lease',
          },
        ],
        markEventReminderDelivered: async () => true,
        markEventReminderFailed: async () => true,
      } as any,
      gateway: { deliver },
      policy,
      broadcastStore: deliveryStore(),
      now: () => now,
    }).tick();

    expect(deliver).not.toHaveBeenCalled();
    expect(policy.evaluate).toHaveBeenCalledTimes(2);
  });

  it('releases a policy-suppressed event reminder claim so it remains retryable', async () => {
    const release = vi.fn().mockResolvedValue(true);
    const markFailed = vi.fn();
    await new EventScheduler({
      repository: {
        claimDueEventReminders: async () => [
          {
            eventId: 'event-1',
            guildId: 'server-1',
            channelId: 'events',
            userId: 'crew-1',
            title: 'Boarding',
            scheduledAt: now,
            leaseToken: 'event-lease',
          },
        ],
        markEventReminderDelivered: async () => true,
        markEventReminderFailed: markFailed,
        releaseEventReminder: release,
      } as never,
      gateway: { deliver: vi.fn() },
      policy: {
        evaluate: vi
          .fn()
          .mockResolvedValue({ allowed: false, reason: 'member_not_opted_in' }),
      },
      broadcastStore: deliveryStore(),
      now: () => now,
    }).tick();

    expect(release).toHaveBeenCalledWith(
      'event-1',
      'server-1',
      'crew-1',
      'event-lease',
      now,
    );
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('delivers a policy-suppressed event reminder when policy resumes one minute after the event closes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-event-policy-'));
    const repository = new SQLiteEngagementRepository(
      join(directory, 'engagement.db'),
    );
    const broadcastStore = deliveryStore();
    const dueAt = new Date(Date.now() + 60_000);
    let deliveries = 0;
    try {
      await repository.createEvent({
        id: 'event-1',
        guildId: 'server-1',
        channelId: 'events',
        ownerUserId: 'owner-1',
        title: 'Boarding',
        description: 'Crew event',
        scheduledAt: dueAt,
        timezone: 'UTC',
        capacity: 10,
        status: 'scheduled',
        createdAt: new Date(dueAt.getTime() - 1),
        updatedAt: new Date(dueAt.getTime() - 1),
      });
      await repository.respondToEvent({
        eventId: 'event-1',
        guildId: 'server-1',
        userId: 'crew-1',
        response: 'yes',
        attendance: 'none',
        reminderOptIn: true,
        createdAt: new Date(dueAt.getTime() - 1),
        updatedAt: new Date(dueAt.getTime() - 1),
      });

      await new EventScheduler({
        repository,
        gateway: {
          deliver: async () => {
            deliveries += 1;
          },
        },
        policy: {
          evaluate: async () => ({
            allowed: false as const,
            reason: 'member_not_opted_in' as const,
          }),
        },
        broadcastStore,
        now: () => dueAt,
      }).tick();

      await new EventScheduler({
        repository,
        gateway: {
          deliver: async () => {
            deliveries += 1;
          },
        },
        policy: { evaluate: async () => ({ allowed: true as const }) },
        broadcastStore,
        now: () => new Date(dueAt.getTime() + 60_000),
      }).tick();

      expect(deliveries).toBe(1);
    } finally {
      await repository.closeConnection();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('marks a policy-suppressed reminder terminal after the retry grace without posting', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-event-grace-'));
    let repository = new SQLiteEngagementRepository(
      join(directory, 'engagement.db'),
    );
    const broadcastStore = deliveryStore();
    const dueAt = new Date(Date.now() + 60_000);
    const deliver = vi.fn();
    try {
      await repository.createEvent({
        id: 'event-grace',
        guildId: 'server-1',
        channelId: 'events',
        ownerUserId: 'owner-1',
        title: 'Boarding',
        description: 'Crew event',
        scheduledAt: dueAt,
        timezone: 'UTC',
        capacity: 10,
        status: 'scheduled',
        createdAt: new Date(dueAt.getTime() - 1),
        updatedAt: new Date(dueAt.getTime() - 1),
      });
      await repository.respondToEvent({
        eventId: 'event-grace',
        guildId: 'server-1',
        userId: 'crew-1',
        response: 'yes',
        attendance: 'none',
        reminderOptIn: true,
        createdAt: new Date(dueAt.getTime() - 1),
        updatedAt: new Date(dueAt.getTime() - 1),
      });
      await new EventScheduler({
        repository,
        gateway: { deliver },
        policy: {
          evaluate: async () => ({
            allowed: false as const,
            reason: 'member_not_opted_in' as const,
          }),
        },
        broadcastStore,
        now: () => dueAt,
      }).tick();
      await repository.closeConnection();
      repository = new SQLiteEngagementRepository(
        join(directory, 'engagement.db'),
      );

      const expired = new EventScheduler({
        repository,
        gateway: { deliver },
        policy: { evaluate: async () => ({ allowed: true as const }) },
        broadcastStore,
        now: () => new Date(dueAt.getTime() + eventReminderRetryGraceMs + 1),
      });
      await expired.tick();

      expect(deliver).not.toHaveBeenCalled();
      expect(expired.lastRun).toMatchObject({ status: 'success' });
      await expect(
        repository.claimDueEventReminders(
          new Date(dueAt.getTime() + eventReminderRetryGraceMs + 2),
          1,
        ),
      ).resolves.toEqual([]);
    } finally {
      await repository.closeConnection();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('persists recap completion so cadence blocks delivery after a scheduler restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-recap-cadence-'));
    const path = join(directory, 'broadcast.db');
    const firstStore = new SqliteBroadcastStore(path);
    const post = vi.fn();
    try {
      await firstStore.setPolicy({
        serverId: 'server-1',
        category: 'recap',
        state: 'enabled',
        channelId: 'recaps',
        timezone: 'UTC',
        minimumIntervalSeconds: 3_600,
        digestMode: false,
        updatedAt: now,
      });
      const first = new RecapScheduler({
        guildId: 'server-1',
        channelId: 'recaps',
        schedule: 'MONDAY 12:00',
        timezone: 'UTC',
        repository: recapRepository(),
        service: readyRecap(),
        gateway: { post },
        policy: new BroadcastPolicyService(firstStore, ['recaps']),
        broadcastStore: firstStore,
        now: () => now,
      });
      await first.tick();
      await firstStore.close();

      const restartedStore = new SqliteBroadcastStore(path);
      const restarted = new RecapScheduler({
        guildId: 'server-1',
        channelId: 'recaps',
        schedule: 'MONDAY 12:00',
        timezone: 'UTC',
        repository: recapRepository(),
        service: readyRecap(),
        gateway: { post },
        policy: new BroadcastPolicyService(restartedStore, ['recaps']),
        broadcastStore: restartedStore,
        now: () => new Date(now.getTime() + 60_000),
      });
      await restarted.tick();
      await restartedStore.close();

      expect(post).toHaveBeenCalledTimes(1);
    } finally {
      await firstStore.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not announce a birthday when the member preference is missing', async () => {
    const announce = vi.fn();
    const policy = {
      evaluate: vi
        .fn()
        .mockResolvedValue({ allowed: false, reason: 'member_not_opted_in' }),
    };
    await new BirthdayScheduler({
      store: {
        due: async () => [
          {
            guildId: 'server-1',
            userId: 'crew-1',
            month: 8,
            day: 10,
            timezone: 'UTC',
            enabled: true,
            updatedAt: now,
          },
        ],
        claimAnnouncement: async () => true,
      } as never,
      gateway: { announce },
      guildId: 'server-1',
      channelId: 'birthdays',
      timezone: 'UTC',
      policy,
      broadcastStore: deliveryStore(),
      now: () => now,
    }).tick();

    expect(announce).not.toHaveBeenCalled();
    expect(policy.evaluate).toHaveBeenCalledTimes(1);
  });
});

const deliveryStore = () => ({
  claimDelivery: async () => 'broadcast-lease',
  completeDelivery: async () => true,
  releaseDelivery: async () => true,
});

const recapRepository = () =>
  ({
    recapEnabled: async () => true,
    claimRecapRun: async () => 'recap-lease',
    completeRecapRun: async () => true,
    releaseRecapRun: async () => true,
  }) as any;

const readyRecap = () =>
  ({
    preview: async () => ({ status: 'ready' as const, content: 'safe recap' }),
  }) as any;
