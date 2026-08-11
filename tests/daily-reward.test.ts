import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DailyRewardService } from '../src/engagement/daily-rewards.js';
import { SQLiteEngagementRepository } from '../src/storage/engagement-sqlite.js';

let repository: SQLiteEngagementRepository | undefined;
let directory: string | undefined;

afterEach(async () => {
  await repository?.closeConnection();
  if (directory) await rm(directory, { recursive: true, force: true });
  repository = undefined;
  directory = undefined;
});

describe('daily rewards', () => {
  it('awards one bounded reward per server member and UTC day', async () => {
    const claims = new Set<string>();
    const store = {
      claim: async (serverId: string, userId: string, day: string) => {
        const key = `${serverId}:${userId}:${day}`;
        if (claims.has(key)) return false;
        claims.add(key);
        return true;
      },
      optedOut: async () => false,
    };
    const service = new DailyRewardService(store);
    const now = new Date('2026-08-11T15:00:00Z');
    await expect(service.claim('server-1', 'user-1', now)).resolves.toEqual({
      awarded: true,
      amount: 10,
      day: '2026-08-11',
    });
    await expect(service.claim('server-1', 'user-1', now)).resolves.toEqual({
      awarded: false,
      amount: 0,
      day: '2026-08-11',
    });
  });

  it('does not award opted-out members', async () => {
    const service = new DailyRewardService({
      claim: async () => true,
      optedOut: async () => true,
    });
    await expect(
      service.claim('server-1', 'user-1', new Date('2026-08-11T15:00:00Z')),
    ).resolves.toMatchObject({ awarded: false, amount: 0 });
  });

  it('persists the once-per-day claim across repository reopen', async () => {
    directory = await mkdtemp(join(tmpdir(), 'jarvis-daily-'));
    const path = join(directory, 'engagement.db');
    repository = new SQLiteEngagementRepository(path);
    const service = new DailyRewardService({
      claim: repository.claimDailyReward.bind(repository),
      optedOut: repository.isEngagementOptedOut.bind(repository),
    });
    const now = new Date('2026-08-11T15:00:00Z');
    await expect(
      service.claim('server-1', 'user-1', now),
    ).resolves.toMatchObject({ awarded: true });
    await repository.closeConnection();
    repository = new SQLiteEngagementRepository(path);
    const reopened = new DailyRewardService({
      claim: repository.claimDailyReward.bind(repository),
      optedOut: repository.isEngagementOptedOut.bind(repository),
    });
    await expect(
      reopened.claim('server-1', 'user-1', now),
    ).resolves.toMatchObject({ awarded: false });
  });
});
