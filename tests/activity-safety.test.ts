import { describe, expect, it } from 'vitest';
import {
  validateTriviaQuestion,
  TriviaService,
} from '../src/engagement/activity.js';

describe('trivia safety', () => {
  it('rejects malformed or answer-leaking catalog entries', () => {
    expect(() =>
      validateTriviaQuestion({
        id: 'bad',
        prompt: 'A valid question?',
        answers: ['one'],
        correctAnswerIndex: 0,
      }),
    ).toThrow('exactly 2 to 4 answers');
    expect(() =>
      validateTriviaQuestion({
        id: 'bad',
        prompt: 'The answer is Mars',
        answers: ['Mars', 'Venus'],
        correctAnswerIndex: 0,
      }),
    ).toThrow('must not reveal');
  });

  it('rejects bot users, opt-outs, and cross-guild controls', async () => {
    const service = new TriviaService({
      repository: {
        getOptOut: async (guildId: string, userId: string) =>
          userId === 'opted-out' ? { guildId, userId } : undefined,
        createTriviaRound: async (value: any) => value,
        getTriviaRound: async () => ({
          id: 'round-1',
          guildId: 'guild-a',
          channelId: 'channel-a',
          ownerUserId: 'admin',
          questionId: 'space-red-planet',
          status: 'open',
          expiresAt: new Date('2026-08-08T12:01:00.000Z'),
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
        recordTriviaAnswer: async (value: any) => value,
      },
      now: () => new Date('2026-08-08T12:00:00.000Z'),
      createId: () => 'round-1',
    });
    await expect(
      service.answer({
        guildId: 'guild-a',
        channelId: 'channel-a',
        roundId: 'round-1',
        userId: 'bot',
        answerIndex: 0,
        isBot: true,
      }),
    ).rejects.toMatchObject({ code: 'bot' });
    await expect(
      service.answer({
        guildId: 'guild-a',
        channelId: 'channel-a',
        roundId: 'round-1',
        userId: 'opted-out',
        answerIndex: 0,
      }),
    ).rejects.toMatchObject({ code: 'opted-out' });
    await expect(
      service.answer({
        guildId: 'guild-b',
        channelId: 'channel-a',
        roundId: 'round-1',
        userId: 'member',
        answerIndex: 0,
      }),
    ).rejects.toMatchObject({ code: 'not-found' });
  });
});
