import { describe, expect, it, vi } from 'vitest';
import { RecapScheduler } from '../src/engagement/recap.js';

describe('recap scheduler', () => {
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
        claimIdempotencyKey: claim,
      } as any,
      service: {
        preview: async () => ({ status: 'ready', content: 'safe recap' }),
      } as any,
      gateway: { post },
      now: () => new Date('2026-08-07T12:05:00Z'),
    });
    await scheduler.tick();
    await scheduler.tick();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('recaps', 'safe recap');
  });
});
