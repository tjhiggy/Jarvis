import { describe, expect, it } from 'vitest';
import {
  validateTriviaQuestion,
  TriviaService,
} from '../src/engagement/activity.js';
import { handleTriviaCommand } from '../src/commands/activity.js';

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

  it('lets a member opt out and later opt back in without retaining answer text', async () => {
    const changes: string[] = [];
    const service = new TriviaService({
      repository: {
        getOptOut: async () => undefined,
        setOptOut: async (input: any) => {
          changes.push(`out:${input.userId}`);
          return input;
        },
        clearOptOut: async (guildId: string, userId: string) => {
          changes.push(`in:${guildId}:${userId}`);
        },
        createTriviaRound: async (value: any) => value,
        getTriviaRound: async () => undefined,
        recordTriviaAnswer: async (value: any) => value,
      },
      now: () => new Date('2026-08-08T12:00:00.000Z'),
      createId: () => 'round-1',
    });
    await service.optOut('guild-a', 'member');
    await service.optIn('guild-a', 'member');
    expect(changes).toEqual(['out:member', 'in:guild-a:member']);
  });

  it('exposes member opt-out and opt-in without requiring the activity channel', async () => {
    const calls: string[] = [];
    const interaction: any = {
      guildId: 'guild-a',
      channelId: 'another-channel',
      user: { id: 'member' },
      options: { getSubcommand: () => 'opt-out' },
      reply: async (payload: any) => calls.push(payload.content),
    };
    const service = {
      optOut: async () => calls.push('opt-out'),
      optIn: async () => calls.push('opt-in'),
    };
    await handleTriviaCommand(interaction, {
      enabled: true,
      channelId: 'activity-channel',
      service: service as any,
    });
    interaction.options.getSubcommand = () => 'opt-in';
    await handleTriviaCommand(interaction, {
      enabled: true,
      channelId: 'activity-channel',
      service: service as any,
    });
    expect(calls).toEqual([
      'opt-out',
      'Trivia participation is off. Your retained activity records were removed; you can use `/trivia opt-in` later.',
      'opt-in',
      'Trivia participation is on for future rounds.',
    ]);
  });

  it('discloses the configured trivia retention instead of a hard-coded period', async () => {
    let reply: any;
    await handleTriviaCommand(
      {
        guildId: 'guild-a',
        channelId: 'activity-channel',
        user: { id: 'member' },
        options: { getSubcommand: () => 'start' },
        reply: async (payload: any) => {
          reply = payload;
        },
      },
      {
        enabled: true,
        channelId: 'activity-channel',
        retentionDays: 7,
        service: {
          start: async () => ({
            id: 'round-1',
            question: { prompt: 'Question?', answers: ['A', 'B'] },
          }),
        } as any,
      },
    );

    expect(JSON.stringify(reply)).toContain('retained for up to 7 days');
    expect(JSON.stringify(reply)).not.toContain('30 days');
    expect(reply.components).toEqual([
      {
        type: 1,
        components: [
          expect.objectContaining({
            type: 2,
            custom_id: 'trivia:v1:round-1:0',
            style: 2,
          }),
          expect.objectContaining({
            type: 2,
            custom_id: 'trivia:v1:round-1:1',
            style: 2,
          }),
        ],
      },
    ]);
  });
});
