import { describe, expect, it } from 'vitest';
import { buildProgressionSummary } from '../src/community/progression.js';

describe('progression summary', () => {
  it('projects bounded server progression without exposing content', () => {
    expect(
      buildProgressionSummary([
        {
          userId: 'a',
          coins: 10,
          xp: 40,
          level: 2,
          achievements: ['first'],
          titles: ['Crew'],
        },
        {
          userId: 'b',
          coins: 5,
          xp: 80,
          level: 3,
          achievements: [],
          titles: [],
        },
      ]),
    ).toMatchObject({
      memberCount: 2,
      totalCoins: 15,
      totalXp: 120,
      leaderboard: [{ userId: 'b', xp: 80, level: 3 }],
    });
  });
  it('caps leaderboard and member input', () => {
    const members = Array.from({ length: 1100 }, (_, index) => ({
      userId: String(index),
      coins: 1,
      xp: index,
      level: 1,
      achievements: [],
      titles: [],
    }));
    const result = buildProgressionSummary(members);
    expect(result.memberCount).toBe(1000);
    expect(result.leaderboard).toHaveLength(10);
  });
});
