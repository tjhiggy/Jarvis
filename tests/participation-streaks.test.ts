import { describe, expect, it } from 'vitest';
import { ParticipationStreakService } from '../src/engagement/participation-streaks.js';

describe('participation streaks', () => {
  it('tracks consecutive days and resets after a gap', async () => {
    const rows = new Map<string, { day: string; current: number; longest: number }>();
    const service = new ParticipationStreakService({
      optedOut: async () => false,
      record: async (server, user, day) => {
        const key = `${server}:${user}`; const old = rows.get(key);
        const prior = new Date(`${day}T00:00:00Z`); prior.setUTCDate(prior.getUTCDate() - 1);
        const current = old?.day === prior.toISOString().slice(0, 10) ? old.current + 1 : 1;
        const longest = Math.max(old?.longest ?? 0, current); rows.set(key, { day, current, longest }); return { current, longest };
      },
    });
    expect((await service.record('s', 'u', new Date('2026-08-01T12:00:00Z'))).current).toBe(1);
    expect((await service.record('s', 'u', new Date('2026-08-02T12:00:00Z'))).current).toBe(2);
    expect((await service.record('s', 'u', new Date('2026-08-04T12:00:00Z'))).current).toBe(1);
  });
});
