import { describe, expect, it } from 'vitest';
import {
  TriviaExpiryScheduler,
  TriviaService,
} from '../src/engagement/activity.js';

describe('bounded trivia activity', () => {
  it('opens a deterministic curated question and records one answer per participant', async () => {
    const service = new TriviaService({
      repository: repository(),
      now: () => new Date('2026-08-08T12:00:00.000Z'),
      createId: () => 'round-1',
      durationMs: 60_000,
    });

    const round = await service.start({
      guildId: 'guild-a',
      channelId: 'channel-a',
      ownerUserId: 'admin',
    });
    expect(round.question.prompt).toBe(
      'Which planet is known as the Red Planet?',
    );
    await expect(
      service.answer({
        guildId: 'guild-a',
        channelId: 'channel-a',
        roundId: round.id,
        userId: 'member',
        answerIndex: 2,
      }),
    ).resolves.toMatchObject({ correct: true });
    await expect(
      service.answer({
        guildId: 'guild-a',
        channelId: 'channel-a',
        roundId: round.id,
        userId: 'member',
        answerIndex: 1,
      }),
    ).rejects.toMatchObject({ code: 'duplicate-answer' });
  });

  it('expires a round and publishes only aggregate results', async () => {
    let now = new Date('2026-08-08T12:00:00.000Z');
    const service = new TriviaService({
      repository: repository(),
      now: () => now,
      createId: () => 'round-1',
      durationMs: 1_000,
    });
    const round = await service.start({
      guildId: 'guild-a',
      channelId: 'channel-a',
      ownerUserId: 'admin',
    });
    now = new Date('2026-08-08T12:00:02.000Z');
    await expect(
      service.answer({
        guildId: 'guild-a',
        channelId: 'channel-a',
        roundId: round.id,
        userId: 'member',
        answerIndex: 0,
      }),
    ).rejects.toMatchObject({ code: 'expired' });
    await expect(service.results('guild-a', round.id)).resolves.toMatchObject({
      participantCount: 0,
      correctCount: 0,
      status: 'expired',
    });
  });

  it('recovers an expired persisted round after restart', async () => {
    let now = new Date('2026-08-08T12:00:00.000Z');
    const stored: any[] = [];
    const first = new TriviaService({
      repository: repository(stored),
      now: () => now,
      createId: () => 'round-1',
      durationMs: 1_000,
    });
    await first.start({
      guildId: 'guild-a',
      channelId: 'channel-a',
      ownerUserId: 'admin',
    });
    now = new Date('2026-08-08T12:00:02.000Z');
    const restarted = new TriviaService({
      repository: repository(stored),
      now: () => now,
      createId: () => 'round-2',
      durationMs: 1_000,
    });
    await expect(restarted.recover()).resolves.toBe(1);
    expect(stored[0]).toMatchObject({ status: 'expired' });
  });

  it('expires stale rounds before opening a replacement during normal uptime', async () => {
    let now = new Date('2026-08-08T12:00:00.000Z');
    const stored: any[] = [];
    const service = new TriviaService({
      repository: repository(stored),
      now: () => now,
      createId: () => `round-${stored.length + 1}`,
      durationMs: 1_000,
    });
    await service.start({
      guildId: 'guild-a',
      channelId: 'channel-a',
      ownerUserId: 'admin',
    });
    now = new Date('2026-08-08T12:00:02.000Z');
    await expect(
      service.start({
        guildId: 'guild-a',
        channelId: 'channel-a',
        ownerUserId: 'admin',
      }),
    ).resolves.toMatchObject({ id: 'round-2' });
    expect(stored[0]).toMatchObject({ status: 'expired' });
  });

  it('runs explicit scheduled expiry while the process is up', async () => {
    const calls: string[] = [];
    const scheduler = new TriviaExpiryScheduler({
      service: {
        claimResultCards: async () => [
          {
            id: 'round-1',
            guildId: 'guild-a',
            channelId: 'channel-a',
            leaseToken: 'lease-1',
          },
        ],
        results: async () => ({ participantCount: 3, correctCount: 2 }),
        completeResultCard: async () => calls.push('complete'),
        releaseResultCard: async () => calls.push('release'),
      } as any,
      gateway: {
        post: async (_round: any, results: any) => {
          calls.push(
            `post:${results.correctCount}/${results.participantCount}`,
          );
        },
      },
    });
    await scheduler.tick();
    expect(calls).toEqual(['post:2/3', 'complete']);
  });
});

function repository(rounds: any[] = []) {
  return {
    getOptOut: async () => undefined,
    createTriviaRound: async (round: any) => {
      rounds.push(round);
      return round;
    },
    getTriviaRound: async (guildId: string, id: string) =>
      rounds.find((round) => round.guildId === guildId && round.id === id),
    findOpenTriviaRound: async (guildId: string) =>
      rounds.find(
        (round) => round.guildId === guildId && round.status === 'open',
      ),
    recordTriviaAnswer: async (answer: any) => answer,
    expireTriviaRounds: async (now: Date) => {
      let count = 0;
      for (const round of rounds)
        if (round.status === 'open' && round.expiresAt <= now) {
          round.status = 'expired';
          round.updatedAt = now;
          count++;
        }
      return count;
    },
    getTriviaResults: async (guildId: string, roundId: string) => ({
      guildId,
      roundId,
      participantCount: 0,
      correctCount: 0,
    }),
  };
}
