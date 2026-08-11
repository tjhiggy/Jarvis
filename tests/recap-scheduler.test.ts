import { describe, expect, it, vi } from 'vitest';
import { RecapScheduler } from '../src/engagement/recap.js';

describe('recap scheduler', () => {
  it('re-checks pause after generating a recap and releases its lease without posting', async () => {
    const post = vi.fn();
    const release = vi.fn().mockResolvedValue(true);
    await new RecapScheduler({
      guildId: 'guild-a',
      channelId: 'recaps',
      schedule: 'FRIDAY 12:00',
      timezone: 'UTC',
      repository: {
        engagementPaused: vi
          .fn()
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true),
        recapEnabled: async () => true,
        claimRecapRun: async () => 'lease-1',
        completeRecapRun: async () => true,
        releaseRecapRun: release,
      } as any,
      service: {
        preview: async () => ({ status: 'ready', content: 'safe recap' }),
      } as any,
      gateway: { post },
      policy: allowPolicy(),
      broadcastStore: deliveryStore(),
      now: () => new Date('2026-08-07T12:05:00Z'),
    }).tick();
    expect(post).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalled();
  });
  it('posts once for a due opt-in guild and makes duplicate runs idempotent', async () => {
    const post = vi.fn().mockResolvedValue(undefined);
    const claim = vi.fn(async () => claim.mock.calls.length === 1);
    const scheduler = new RecapScheduler({
      guildId: 'guild-a',
      channelId: 'recaps',
      schedule: 'FRIDAY 12:00',
      timezone: 'UTC',
      repository: {
        recapEnabled: async () => true,
        claimRecapRun: async () => {
          claim();
          return claim.mock.calls.length === 1 ? 'lease-1' : undefined;
        },
        completeRecapRun: async () => true,
        releaseRecapRun: async () => false,
      } as any,
      service: {
        preview: async () => ({ status: 'ready', content: 'safe recap' }),
      } as any,
      gateway: { post },
      policy: allowPolicy(),
      broadcastStore: deliveryStore(),
      now: () => new Date('2026-08-07T12:05:00Z'),
    });
    await scheduler.tick();
    await scheduler.tick();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('recaps', 'safe recap');
  });

  it('releases a leased run after unavailable source data so a restart can retry it', async () => {
    const release = vi.fn().mockResolvedValue(true);
    const scheduler = new RecapScheduler({
      guildId: 'guild-a',
      channelId: 'recaps',
      schedule: 'FRIDAY 12:00',
      timezone: 'UTC',
      repository: {
        recapEnabled: async () => true,
        claimRecapRun: async () => 'lease-1',
        completeRecapRun: async () => true,
        releaseRecapRun: release,
      } as any,
      service: { preview: async () => ({ status: 'unavailable' }) } as any,
      gateway: { post: vi.fn() },
      policy: allowPolicy(),
      broadcastStore: deliveryStore(),
      now: () => new Date('2026-08-07T12:05:00Z'),
    });
    await scheduler.tick();
    expect(release).toHaveBeenCalledWith(
      'guild-a',
      'weekly-recap:UTC:2026-08-07T12:00',
      'lease-1',
      expect.any(Date),
    );
  });

  it('releases a leased run after gateway failure so the next worker can retry', async () => {
    let leased = false;
    let completed = false;
    const repository = {
      recapEnabled: async () => true,
      claimRecapRun: async () => {
        if (leased || completed) return undefined;
        leased = true;
        return 'lease-2';
      },
      completeRecapRun: async () => {
        completed = true;
        return true;
      },
      releaseRecapRun: async () => {
        leased = false;
        return true;
      },
    };
    const scheduler = new RecapScheduler({
      guildId: 'guild-a',
      channelId: 'recaps',
      schedule: 'FRIDAY 12:00',
      timezone: 'UTC',
      repository: repository as any,
      service: {
        preview: async () => ({ status: 'ready', content: 'safe recap' }),
      } as any,
      gateway: {
        post: async () => {
          throw new Error('Discord unavailable');
        },
      },
      policy: allowPolicy(),
      broadcastStore: deliveryStore(),
      now: () => new Date('2026-08-07T12:05:00Z'),
    });
    await scheduler.tick();
    const post = vi.fn().mockResolvedValue(undefined);
    await new RecapScheduler({
      guildId: 'guild-a',
      channelId: 'recaps',
      schedule: 'FRIDAY 12:00',
      timezone: 'UTC',
      repository: repository as any,
      service: {
        preview: async () => ({ status: 'ready', content: 'safe recap' }),
      } as any,
      gateway: { post },
      policy: allowPolicy(),
      broadcastStore: deliveryStore(),
      now: () => new Date('2026-08-07T12:05:00Z'),
    }).tick();
    expect(post).toHaveBeenCalledOnce();
    expect(completed).toBe(true);
  });

  it('keys a scheduled run by its configured local slot across UTC midnight', async () => {
    const claim = vi.fn().mockResolvedValue('lease-local');
    await new RecapScheduler({
      guildId: 'guild-a',
      channelId: 'recaps',
      schedule: 'FRIDAY 23:30',
      timezone: 'America/Los_Angeles',
      repository: {
        recapEnabled: async () => true,
        claimRecapRun: claim,
        completeRecapRun: async () => true,
        releaseRecapRun: async () => false,
      } as any,
      service: {
        preview: async () => ({ status: 'ready', content: 'safe recap' }),
      } as any,
      gateway: { post: vi.fn() },
      policy: allowPolicy(),
      broadcastStore: deliveryStore(),
      now: () => new Date('2026-08-08T06:35:00.000Z'),
    }).tick();

    expect(claim).toHaveBeenCalledWith(
      'guild-a',
      'weekly-recap:America/Los_Angeles:2026-08-07T23:30',
      new Date('2026-08-08T06:35:00.000Z'),
    );
  });
});

const allowPolicy = () => ({
  evaluate: async () => ({ allowed: true as const }),
});

const deliveryStore = () => ({
  claimDelivery: async () => 'broadcast-lease',
  completeDelivery: async () => true,
  releaseDelivery: async () => true,
});
