import { describe, expect, it, vi } from 'vitest';
import {
  DurableProactiveScheduler,
  ProactiveEngagementService,
} from '../src/engagement/proactive.js';
import { SQLiteEngagementRepository } from '../src/storage/engagement-sqlite.js';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('proactive engagement safety', () => {
  const setup = (state: 'disabled' | 'enabled' | 'paused' = 'enabled') => {
    let saved: { state: typeof state; lastPostedAt?: Date } = { state };
    const posts: string[] = [];
    const store = {
      get: async () => (saved.lastPostedAt ? saved : { state: saved.state }),
      set: async (_guild: string, next: typeof state, at: Date) => {
        saved =
          next === 'enabled'
            ? { state: next, lastPostedAt: at }
            : { state: next };
      },
    };
    const service = new ProactiveEngagementService({
      store,
      gateway: {
        post: async (_channel, text) => {
          posts.push(text);
        },
      },
      channelId: 'channel-1',
      guildId: 'guild-1',
      now: () => new Date('2026-08-09T12:00:00Z'),
      isGloballyPaused: async () => false,
      catalog: [
        {
          id: 'crew-check-in',
          category: 'community',
          text: '@everyone Crew check-in: what is everyone playing today?',
          active: true,
        },
      ],
      policy: {
        evaluate: async () => ({ allowed: true }),
      },
      broadcastStore: {
        claimDelivery: async () => 'lease-token',
        completeDelivery: async () => true,
        releaseDelivery: async () => true,
      },
    });
    return { service, posts };
  };

  it('previews without posting and neutralizes mentions', async () => {
    const { service, posts } = setup('disabled');
    expect(await service.preview()).not.toContain('@everyone');
    expect(posts).toHaveLength(0);
  });

  it('does not post while disabled or paused', async () => {
    expect(await setup('disabled').service.tick()).toBe(false);
    expect(await setup('paused').service.tick()).toBe(false);
  });

  it('posts once when enabled and records state', async () => {
    const { service, posts } = setup();
    expect(await service.tick()).toBe(true);
    expect(posts).toHaveLength(1);
  });

  it('releases a failed delivery so the approved prompt can be retried', async () => {
    let fail = true;
    const releases: string[] = [];
    const service = new ProactiveEngagementService({
      store: {
        get: async () => ({ state: 'enabled' as const }),
        set: async () => undefined,
      },
      gateway: {
        post: async () => {
          if (fail) throw new Error('temporary network failure');
        },
      },
      channelId: 'channel-1',
      guildId: 'guild-1',
      now: () => new Date('2026-08-11T12:00:00Z'),
      isGloballyPaused: async () => false,
      catalog: [
        {
          id: 'crew-check-in',
          category: 'community',
          text: 'Crew check-in: what is everyone playing today?',
          active: true,
        },
      ],
      policy: { evaluate: async () => ({ allowed: true }) },
      broadcastStore: {
        claimDelivery: async () => 'lease-token',
        completeDelivery: async () => true,
        releaseDelivery: async (
          _server,
          _category,
          _key,
          _token,
          _now,
          error,
        ) => {
          if (error !== undefined) releases.push(error);
          return true;
        },
      },
    });

    expect(await service.tick()).toBe(false);
    expect(releases).toEqual(['network']);
    fail = false;
    expect(await service.tick()).toBe(true);
  });

  it('does not post when policy pauses after delivery is claimed', async () => {
    let policyChecks = 0;
    let postCalls = 0;
    const service = new ProactiveEngagementService({
      store: {
        get: async () => ({ state: 'enabled' as const }),
        set: async () => undefined,
      },
      gateway: {
        post: async () => {
          postCalls += 1;
        },
      },
      channelId: 'channel-1',
      guildId: 'guild-1',
      now: () => new Date('2026-08-11T12:00:00Z'),
      isGloballyPaused: async () => false,
      catalog: [
        {
          id: 'crew-check-in',
          category: 'community',
          text: 'Crew check-in: what is everyone playing today?',
          active: true,
        },
      ],
      policy: {
        evaluate: async () => {
          policyChecks += 1;
          return policyChecks === 1
            ? { allowed: true as const }
            : { allowed: false as const, reason: 'globally_paused' as const };
        },
      },
      broadcastStore: {
        claimDelivery: async () => 'lease-token',
        completeDelivery: async () => true,
        releaseDelivery: async () => true,
      },
    });

    expect(await service.tick()).toBe(false);
    expect(policyChecks).toBe(2);
    expect(postCalls).toBe(0);
  });

  it('blocks delivery when a persisted global pause lands before the final policy check', async () => {
    let globallyPaused = false;
    let postCalls = 0;
    const policyPauses: boolean[] = [];
    const service = new ProactiveEngagementService({
      store: {
        get: async () => ({ state: 'enabled' as const }),
        set: async () => undefined,
      },
      gateway: {
        post: async () => {
          postCalls += 1;
        },
      },
      channelId: 'channel-1',
      guildId: 'guild-1',
      now: () => new Date('2026-08-11T12:00:00Z'),
      catalog: [
        {
          id: 'crew-check-in',
          category: 'community',
          text: 'Crew check-in: what is everyone playing today?',
          active: true,
        },
      ],
      isGloballyPaused: async () => globallyPaused,
      policy: {
        evaluate: async (input) => {
          policyPauses.push(input.globallyPaused === true);
          return input.globallyPaused === true
            ? { allowed: false as const, reason: 'globally_paused' as const }
            : { allowed: true as const };
        },
      },
      broadcastStore: {
        claimDelivery: async () => {
          globallyPaused = true;
          return 'lease-token';
        },
        completeDelivery: async () => true,
        releaseDelivery: async () => true,
      },
    });

    expect(await service.tick()).toBe(false);
    expect(policyPauses).toEqual([false, true]);
    expect(postCalls).toBe(0);
  });

  it('persists proactive state and idempotency across repository instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-proactive-'));
    const path = join(directory, 'engagement.db');
    const first = new SQLiteEngagementRepository(path);
    await first.setProactiveState!(
      'guild-1',
      'enabled',
      new Date('2026-08-09T12:00:00Z'),
    );
    await first.recordProactivePosted!(
      'guild-1',
      new Date('2026-08-09T12:00:00Z'),
    );
    expect(await first.getProactiveState!('guild-1')).toEqual({
      state: 'enabled',
      lastPostedAt: new Date('2026-08-09T12:00:00Z'),
    });
    expect(
      await first.claimProactive!(
        'guild-1',
        '2026-08-09T12',
        new Date('2026-08-09T12:00:00Z'),
      ),
    ).toBe(true);
    await first.closeConnection();
    const second = new SQLiteEngagementRepository(path);
    expect(await second.getProactiveState!('guild-1')).toEqual({
      state: 'enabled',
      lastPostedAt: new Date('2026-08-09T12:00:00Z'),
    });
    expect(
      await second.claimProactive!(
        'guild-1',
        '2026-08-09T12',
        new Date('2026-08-09T12:01:00Z'),
      ),
    ).toBe(false);
    await second.closeConnection();
  });
});

describe('proactive scheduler lifecycle', () => {
  it('stops new ticks and waits for an in-flight tick to finish', async () => {
    vi.useFakeTimers();
    let releaseTick = (): void => undefined;
    const tickBlocked = new Promise<void>((resolve) => {
      releaseTick = resolve;
    });
    let ticks = 0;
    const scheduler = new DurableProactiveScheduler(
      {
        tick: async () => {
          ticks += 1;
          await tickBlocked;
          return false;
        },
      } as unknown as ProactiveEngagementService,
      60_000,
    );

    try {
      scheduler.start();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(ticks).toBe(1);

      let stopped = false;
      const stopping = scheduler.stop().then(() => {
        stopped = true;
      });
      await Promise.resolve();
      expect(stopped).toBe(false);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(ticks).toBe(1);

      releaseTick();
      await stopping;
      expect(stopped).toBe(true);
    } finally {
      releaseTick();
      await scheduler.stop();
      vi.useRealTimers();
    }
  });

  it('projects interval failures without logging proactive prompt content', async () => {
    vi.useFakeTimers();
    const warnings: Array<Record<string, unknown>> = [];
    const scheduler = new DurableProactiveScheduler(
      {
        tick: async () => {
          throw new Error('Crew prompt: secret message');
        },
      } as unknown as ProactiveEngagementService,
      60_000,
      {
        warn: (context) => {
          warnings.push(context);
        },
      },
    );

    try {
      scheduler.start();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(warnings).toEqual([
        {
          errorClass: 'Error',
          errorCategory: 'proactive_scheduler',
        },
      ]);
      expect(JSON.stringify(warnings)).not.toContain('secret message');
    } finally {
      await scheduler.stop();
      vi.useRealTimers();
    }
  });
});
