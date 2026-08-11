import { describe, expect, it } from 'vitest';
import { ProactiveEngagementService } from '../src/engagement/proactive.js';
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
