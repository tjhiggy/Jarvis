import { describe, expect, it, vi } from 'vitest';
import {
  BirthdayScheduler,
  BirthdayService,
  parseBirthday,
} from '../src/engagement/birthdays.js';

describe('birthdays', () => {
  it('accepts month/day only and rejects years and invalid dates', () => {
    expect(parseBirthday('02-29')).toEqual({ month: 2, day: 29 });
    expect(() => parseBirthday('1990-02-01')).toThrow();
    expect(() => parseBirthday('02-31')).toThrow();
  });
  it('stores an opted-in birthday and supports deletion', async () => {
    const store = {
      get: vi.fn(),
      upsert: vi.fn(async (v) => v),
      delete: vi.fn(async () => true),
      due: vi.fn(),
      claimAnnouncement: vi.fn(),
    };
    const service = new BirthdayService(store);
    const result = await service.set({
      guildId: 'g',
      userId: 'u',
      date: '07-04',
      timezone: 'UTC',
    });
    expect(result).toMatchObject({ month: 7, day: 4, enabled: true });
    await expect(service.remove('g', 'u')).resolves.toBe(true);
  });
  it('announces once with no date disclosure', async () => {
    const store = {
      due: vi.fn(async () => [
        {
          guildId: 'g',
          userId: 'u',
          month: 7,
          day: 4,
          timezone: 'UTC',
          enabled: true,
          updatedAt: new Date(),
        },
      ]),
      claimAnnouncement: vi.fn(async () => true),
    };
    const announce = vi.fn();
    const scheduler = new BirthdayScheduler({
      store: store as never,
      gateway: { announce },
      guildId: 'g',
      channelId: 'c',
      timezone: 'UTC',
      policy: { evaluate: async () => ({ allowed: true as const }) },
      broadcastStore: {
        claimDelivery: async () => 'broadcast-lease',
        completeDelivery: async () => true,
        releaseDelivery: async () => true,
      },
      now: () => new Date('2026-07-04T12:00:00Z'),
    });
    await scheduler.tick();
    expect(announce).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.not.stringMatching(/07-04|2026/),
        allowedMentions: { parse: [], users: ['u'], repliedUser: false },
      }),
    );
  });

  it('does not claim a birthday lease when delivery is globally paused', async () => {
    const claimDelivery = vi.fn(async () => 'broadcast-lease');
    const announce = vi.fn();
    const scheduler = new BirthdayScheduler({
      store: {
        due: vi.fn(async () => [dueBirthday()]),
        claimAnnouncement: vi.fn(),
      } as never,
      gateway: { announce },
      guildId: 'g',
      channelId: 'c',
      timezone: 'UTC',
      policy: {
        evaluate: async (input) =>
          input.globallyPaused === true
            ? { allowed: false as const, reason: 'globally_paused' as const }
            : { allowed: true as const },
      },
      broadcastStore: {
        claimDelivery,
        completeDelivery: async () => true,
        releaseDelivery: async () => true,
      },
      isGloballyPaused: async () => true,
      now: () => new Date('2026-07-04T12:00:00Z'),
    });
    await scheduler.tick();
    expect(claimDelivery).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  it('releases the broadcast lease when the per-member announcement claim loses', async () => {
    const releaseDelivery = vi.fn(async () => true);
    const announce = vi.fn();
    const scheduler = new BirthdayScheduler({
      store: {
        due: vi.fn(async () => [dueBirthday()]),
        claimAnnouncement: vi.fn(async () => false),
      } as never,
      gateway: { announce },
      guildId: 'g',
      channelId: 'c',
      timezone: 'UTC',
      policy: { evaluate: async () => ({ allowed: true as const }) },
      broadcastStore: {
        claimDelivery: async () => 'broadcast-lease',
        completeDelivery: async () => true,
        releaseDelivery,
      },
      now: () => new Date('2026-07-04T12:00:00Z'),
    });
    await scheduler.tick();
    expect(announce).not.toHaveBeenCalled();
    expect(releaseDelivery).toHaveBeenCalledWith(
      'g',
      'birthday',
      'birthday:2026:7:4:u',
      'broadcast-lease',
      new Date('2026-07-04T12:00:00Z'),
    );
  });

  it('releases the broadcast lease when Discord announce throws', async () => {
    const releaseDelivery = vi.fn(async () => true);
    const completeDelivery = vi.fn(async () => true);
    const scheduler = new BirthdayScheduler({
      store: {
        due: vi.fn(async () => [dueBirthday()]),
        claimAnnouncement: vi.fn(async () => true),
      } as never,
      gateway: {
        announce: async () => {
          throw new Error('gateway unavailable');
        },
      },
      guildId: 'g',
      channelId: 'c',
      timezone: 'UTC',
      policy: { evaluate: async () => ({ allowed: true as const }) },
      broadcastStore: {
        claimDelivery: async () => 'broadcast-lease',
        completeDelivery,
        releaseDelivery,
      },
      now: () => new Date('2026-07-04T12:00:00Z'),
    });
    await scheduler.tick();
    expect(completeDelivery).not.toHaveBeenCalled();
    expect(releaseDelivery).toHaveBeenCalledWith(
      'g',
      'birthday',
      'birthday:2026:7:4:u',
      'broadcast-lease',
      new Date('2026-07-04T12:00:00Z'),
    );
    expect(scheduler.lastRun).toMatchObject({ status: 'error' });
  });

  it('shares one in-flight tick so overlapping runs cannot double-announce', async () => {
    let releaseDue: (() => void) | undefined;
    let markDueStarted: () => void = () => undefined;
    const dueGate = new Promise<void>((resolve) => {
      markDueStarted = resolve;
    });
    const dueWait = new Promise<void>((resolve) => {
      releaseDue = resolve;
    });
    const announce = vi.fn();
    const claimDelivery = vi.fn(async () => 'broadcast-lease');
    const scheduler = new BirthdayScheduler({
      store: {
        due: async () => {
          markDueStarted();
          await dueWait;
          return [dueBirthday()];
        },
        claimAnnouncement: async () => true,
      } as never,
      gateway: { announce },
      guildId: 'g',
      channelId: 'c',
      timezone: 'UTC',
      policy: { evaluate: async () => ({ allowed: true as const }) },
      broadcastStore: {
        claimDelivery,
        completeDelivery: async () => true,
        releaseDelivery: async () => true,
      },
      now: () => new Date('2026-07-04T12:00:00Z'),
    });

    const first = scheduler.tick();
    await dueGate;
    const second = scheduler.tick();
    releaseDue?.();
    await Promise.all([first, second]);
    expect(claimDelivery).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledTimes(1);
  });
});

function dueBirthday() {
  return {
    guildId: 'g',
    userId: 'u',
    month: 7,
    day: 4,
    timezone: 'UTC',
    enabled: true,
    updatedAt: new Date(),
  };
}
