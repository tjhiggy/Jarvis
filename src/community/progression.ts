export interface ProgressionMember {
  readonly userId: string;
  readonly coins: number;
  readonly xp: number;
  readonly level: number;
  readonly achievements: readonly string[];
  readonly titles: readonly string[];
}

export interface ProgressionSummary {
  readonly memberCount: number;
  readonly totalCoins: number;
  readonly totalXp: number;
  readonly leaderboard: readonly {
    readonly userId: string;
    readonly xp: number;
    readonly level: number;
  }[];
  readonly availableFeatures: readonly string[];
}

export const buildProgressionSummary = (
  members: readonly ProgressionMember[],
): ProgressionSummary => {
  const bounded = members.slice(0, 1000).map((member) => ({
    userId: member.userId,
    coins: Math.max(0, Math.floor(member.coins)),
    xp: Math.max(0, Math.floor(member.xp)),
    level: Math.max(0, Math.floor(member.level)),
    achievements: member.achievements.slice(0, 100),
    titles: member.titles.slice(0, 20),
  }));
  return {
    memberCount: bounded.length,
    totalCoins: bounded.reduce((sum, member) => sum + member.coins, 0),
    totalXp: bounded.reduce((sum, member) => sum + member.xp, 0),
    leaderboard: bounded
      .sort((left, right) => right.xp - left.xp || right.level - left.level)
      .slice(0, 10)
      .map(({ userId, xp, level }) => ({ userId, xp, level })),
    availableFeatures: [
      'coins',
      'inventory',
      'rewards',
      'trading',
      'achievements',
      'xp',
      'voice-xp',
      'leaderboards',
      'titles',
    ],
  };
};
