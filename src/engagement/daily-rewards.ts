export interface DailyRewardStore {
  claim(
    serverId: string,
    userId: string,
    day: string,
    claimedAt: Date,
  ): Promise<boolean>;
  optedOut(serverId: string, userId: string): Promise<boolean>;
  recordParticipation?(
    serverId: string,
    userId: string,
    day: string,
    at: Date,
  ): Promise<{ current: number; longest: number }>;
}

export const dailyRewardStoreFromRepository = (repository: {
  claimDailyReward(
    serverId: string,
    userId: string,
    day: string,
    claimedAt: Date,
  ): Promise<boolean>;
  isEngagementOptedOut(serverId: string, userId: string): Promise<boolean>;
  recordParticipationStreak?: (
    serverId: string,
    userId: string,
    day: string,
    at: Date,
  ) => Promise<{ current: number; longest: number }>;
}): DailyRewardStore => ({
  claim: repository.claimDailyReward.bind(repository),
  optedOut: repository.isEngagementOptedOut.bind(repository),
  ...(repository.recordParticipationStreak === undefined
    ? {}
    : {
        recordParticipation:
          repository.recordParticipationStreak.bind(repository),
      }),
});

export interface DailyRewardResult {
  readonly awarded: boolean;
  readonly amount: number;
  readonly day: string;
}

const dayKey = (now: Date): string => {
  if (Number.isNaN(now.getTime())) throw new RangeError('Invalid date.');
  return now.toISOString().slice(0, 10);
};

export class DailyRewardService {
  constructor(private readonly store: DailyRewardStore) {}

  async claim(
    serverId: string,
    userId: string,
    now = new Date(),
  ): Promise<DailyRewardResult> {
    const day = dayKey(now);
    if (await this.store.optedOut(serverId, userId))
      return { awarded: false, amount: 0, day };
    const awarded = await this.store.claim(serverId, userId, day, now);
    if (awarded)
      await this.store.recordParticipation?.(serverId, userId, day, now);
    return { awarded, amount: awarded ? 10 : 0, day };
  }
}
