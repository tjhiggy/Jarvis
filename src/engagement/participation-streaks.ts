export interface ParticipationStreakStore {
  record(serverId: string, userId: string, day: string, at: Date): Promise<{ current: number; longest: number }>;
  optedOut(serverId: string, userId: string): Promise<boolean>;
}

export interface ParticipationStreakResult { readonly current: number; readonly longest: number; readonly day: string; }

const dayKey = (now: Date) => {
  if (Number.isNaN(now.getTime())) throw new RangeError('Invalid date.');
  return now.toISOString().slice(0, 10);
};

export class ParticipationStreakService {
  constructor(private readonly store: ParticipationStreakStore) {}
  async record(serverId: string, userId: string, now = new Date()): Promise<ParticipationStreakResult> {
    const day = dayKey(now);
    if (await this.store.optedOut(serverId, userId)) return { current: 0, longest: 0, day };
    const streak = await this.store.record(serverId, userId, day, now);
    return { ...streak, day };
  }
}

export const participationStreakStoreFromRepository = (repository: {
  recordParticipationStreak(serverId: string, userId: string, day: string, at: Date): Promise<{ current: number; longest: number }>;
  isEngagementOptedOut(serverId: string, userId: string): Promise<boolean>;
}): ParticipationStreakStore => ({ record: repository.recordParticipationStreak.bind(repository), optedOut: repository.isEngagementOptedOut.bind(repository) });
