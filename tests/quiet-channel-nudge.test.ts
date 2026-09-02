import { describe, expect, it, vi } from 'vitest';
import {
  DurableQuietChannelNudgeScheduler,
  QuietChannelNudgeService,
  evaluateQuietNudge,
} from '../src/engagement/quiet-channel-nudge.js';
import { OpenAIServiceError } from '../src/openai/openai-errors.js';

const fallbackNudge =
  "This deck went quiet. If you're on the MuthaShip, speak up.";

const earthlingsChannel = '953011731356086284';
const testChannel = '1536175231373148181';
const dayMs = 24 * 60 * 60 * 1_000;
const fiveMinutesMs = 5 * 60 * 1_000;

describe('quiet channel nudge evaluation', () => {
  const now = new Date('2026-09-02T12:00:00.000Z');

  it('requires each channel quiet window independently', () => {
    const lastHumanAt = new Date(now.getTime() - 6 * 60 * 60 * 1_000);
    expect(
      evaluateQuietNudge({
        now,
        quietWindowMs: dayMs,
        state: { lastHumanAt },
        paused: false,
        channelConfigured: true,
        channelAvailable: true,
      }).action,
    ).toBe('skip');
    expect(
      evaluateQuietNudge({
        now,
        quietWindowMs: fiveMinutesMs,
        state: { lastHumanAt },
        paused: false,
        channelConfigured: true,
        channelAvailable: true,
      }).action,
    ).toBe('nudge');
  });

  it('does not nudge when engagement is paused', () => {
    expect(
      evaluateQuietNudge({
        now,
        quietWindowMs: fiveMinutesMs,
        state: { lastHumanAt: new Date(now.getTime() - 10 * 60 * 1_000) },
        paused: true,
        channelConfigured: true,
        channelAvailable: true,
      }),
    ).toEqual({ action: 'skip', reason: 'paused' });
  });

  it('fails closed when the channel is unset or unavailable', () => {
    expect(
      evaluateQuietNudge({
        now,
        quietWindowMs: fiveMinutesMs,
        state: {},
        paused: false,
        channelConfigured: false,
        channelAvailable: true,
      }),
    ).toEqual({ action: 'skip', reason: 'unset_channel' });
    expect(
      evaluateQuietNudge({
        now,
        quietWindowMs: fiveMinutesMs,
        state: {},
        paused: false,
        channelConfigured: true,
        channelAvailable: false,
      }),
    ).toEqual({ action: 'skip', reason: 'missing_channel' });
  });

  it('does not nudge while humans are still talking inside the window', () => {
    expect(
      evaluateQuietNudge({
        now,
        quietWindowMs: fiveMinutesMs,
        state: { lastHumanAt: new Date(now.getTime() - 2 * 60 * 1_000) },
        paused: false,
        channelConfigured: true,
        channelAvailable: true,
      }),
    ).toEqual({ action: 'skip', reason: 'channel_active' });
  });

  it('does not nudge twice before humans speak again', () => {
    const lastHumanAt = new Date(now.getTime() - 10 * 60 * 1_000);
    expect(
      evaluateQuietNudge({
        now,
        quietWindowMs: fiveMinutesMs,
        state: {
          lastHumanAt,
          lastNudgeAt: new Date(now.getTime() - 60 * 1_000),
        },
        paused: false,
        channelConfigured: true,
        channelAvailable: true,
      }),
    ).toEqual({ action: 'skip', reason: 'already_nudged' });
    expect(
      evaluateQuietNudge({
        now,
        quietWindowMs: fiveMinutesMs,
        state: {
          lastHumanAt: new Date(now.getTime() - 10 * 60 * 1_000),
          lastNudgeAt: new Date(now.getTime() - 20 * 60 * 1_000),
        },
        paused: false,
        channelConfigured: true,
        channelAvailable: true,
      }).action,
    ).toBe('nudge');
  });

  it('does not nudge without a human baseline', () => {
    expect(
      evaluateQuietNudge({
        now,
        quietWindowMs: fiveMinutesMs,
        state: {},
        paused: false,
        channelConfigured: true,
        channelAvailable: true,
      }),
    ).toEqual({ action: 'skip', reason: 'no_human_baseline' });
  });

  it('uses the more recent of stored and history human timestamps', () => {
    expect(
      evaluateQuietNudge({
        now,
        quietWindowMs: fiveMinutesMs,
        state: { lastHumanAt: new Date(now.getTime() - 10 * 60 * 1_000) },
        latestHumanAt: new Date(now.getTime() - 60 * 1_000),
        paused: false,
        channelConfigured: true,
        channelAvailable: true,
      }),
    ).toEqual({ action: 'skip', reason: 'channel_active' });
  });
});

describe('quiet channel nudge service', () => {
  const setup = (options?: {
    paused?: boolean;
    channels?: ReadonlyArray<{
      channelId: string;
      quietWindowMs: number;
    }>;
    state?: Record<string, { lastHumanAt?: Date; lastNudgeAt?: Date }>;
    latestHumanAt?: Date;
    channelAvailable?: boolean;
    aiText?: string;
    aiRespond?: () => Promise<{ text: string }>;
  }) => {
    const posts: Array<{
      channelId: string;
      content: string;
      allowedMentions: { parse: readonly []; repliedUser: false };
    }> = [];
    const state = new Map<string, { lastHumanAt?: Date; lastNudgeAt?: Date }>(
      Object.entries(options?.state ?? {}),
    );
    const store = {
      get: async (_guildId: string, channelId: string) => state.get(channelId),
      recordHumanMessage: async (
        _guildId: string,
        channelId: string,
        at: Date,
      ) => {
        state.set(channelId, {
          ...(state.get(channelId) ?? {}),
          lastHumanAt: at,
        });
      },
      recordNudge: async (_guildId: string, channelId: string, at: Date) => {
        const current = state.get(channelId) ?? {};
        state.set(channelId, { ...current, lastNudgeAt: at });
      },
    };
    const now = () => new Date('2026-09-02T12:00:00.000Z');
    const service = new QuietChannelNudgeService({
      store,
      gateway: {
        channelAvailable: async () => options?.channelAvailable ?? true,
        post: async (payload) => {
          posts.push(payload);
        },
      },
      ai: {
        respond:
          options?.aiRespond ??
          (async () => ({
            text:
              options?.aiText ?? 'The MuthaShip channel is quiet. Say hello.',
          })),
      },
      guildId: 'guild-1',
      channels: options?.channels ?? [
        { channelId: earthlingsChannel, quietWindowMs: dayMs },
        { channelId: testChannel, quietWindowMs: fiveMinutesMs },
      ],
      isGloballyPaused: async () => options?.paused ?? false,
      history: {
        latestHumanMessageAt: async () => options?.latestHumanAt,
      },
      now,
    });
    return { service, posts, state, now };
  };

  it('ignores bot-only activity and only tracks human messages', async () => {
    const { service, state } = setup();
    await service.recordMessageSnapshot(testChannel, {
      authorIsBot: true,
      createdAt: new Date('2026-09-02T11:59:00.000Z'),
    });
    expect(state.get(testChannel)).toBeUndefined();
    await service.recordHumanMessage(
      testChannel,
      new Date('2026-09-02T11:50:00.000Z'),
    );
    expect(state.get(testChannel)?.lastHumanAt?.toISOString()).toBe(
      '2026-09-02T11:50:00.000Z',
    );
  });

  it('does not post in the wrong channel', async () => {
    const { service, posts } = setup();
    await service.recordHumanMessage(
      '999999999999999999',
      new Date('2026-09-02T11:00:00.000Z'),
    );
    expect(await service.tick()).toBe(false);
    expect(posts).toHaveLength(0);
  });

  it('posts once for the proof channel and uses empty allowed mentions', async () => {
    const { service, posts } = setup({
      latestHumanAt: new Date('2026-09-02T11:54:00.000Z'),
    });
    expect(await service.tick()).toBe(true);
    expect(posts).toEqual([
      {
        channelId: testChannel,
        content: 'The MuthaShip channel is quiet. Say hello.',
        allowedMentions: { parse: [], repliedUser: false },
      },
    ]);
    expect(await service.tick()).toBe(false);
    expect(posts).toHaveLength(1);
  });

  it('waits for humans to speak again before nudging after a prior nudge', async () => {
    let current = new Date('2026-09-02T12:00:00.000Z');
    const posts: Array<{ channelId: string }> = [];
    const state = new Map<string, { lastHumanAt?: Date; lastNudgeAt?: Date }>([
      [
        testChannel,
        {
          lastHumanAt: new Date('2026-09-02T11:54:00.000Z'),
          lastNudgeAt: new Date('2026-09-02T11:59:30.000Z'),
        },
      ],
    ]);
    const service = new QuietChannelNudgeService({
      store: {
        get: async (_guildId, channelId) => state.get(channelId),
        recordHumanMessage: async (_guildId, channelId, at) => {
          state.set(channelId, {
            ...(state.get(channelId) ?? {}),
            lastHumanAt: at,
          });
        },
        recordNudge: async (_guildId, channelId, at) => {
          state.set(channelId, {
            ...(state.get(channelId) ?? {}),
            lastNudgeAt: at,
          });
        },
      },
      gateway: {
        channelAvailable: async () => true,
        post: async (payload) => {
          posts.push(payload);
        },
      },
      ai: {
        respond: async () => ({ text: 'Quiet on the MuthaShip.' }),
      },
      guildId: 'guild-1',
      channels: [{ channelId: testChannel, quietWindowMs: fiveMinutesMs }],
      isGloballyPaused: async () => false,
      now: () => current,
    });

    expect(await service.tick()).toBe(false);
    await service.recordHumanMessage(
      testChannel,
      new Date('2026-09-02T11:59:45.000Z'),
    );
    expect(await service.tick()).toBe(false);
    current = new Date('2026-09-02T12:05:00.000Z');
    expect(await service.tick()).toBe(true);
    expect(posts).toHaveLength(1);
    expect(await service.tick()).toBe(false);
  });

  it('does not post when globally paused', async () => {
    const paused = setup({
      paused: true,
      latestHumanAt: new Date('2026-09-02T11:00:00.000Z'),
    });
    expect(await paused.service.tick()).toBe(false);
    expect(paused.posts).toHaveLength(0);
  });

  it('posts the fallback nudge once when AI composition throws', async () => {
    const failedAi = setup({
      latestHumanAt: new Date('2026-09-02T11:00:00.000Z'),
      channels: [{ channelId: testChannel, quietWindowMs: fiveMinutesMs }],
      aiRespond: async () => {
        throw new OpenAIServiceError('service');
      },
    });
    expect(await failedAi.service.tick()).toBe(true);
    expect(failedAi.posts).toEqual([
      {
        channelId: testChannel,
        content: fallbackNudge,
        allowedMentions: { parse: [], repliedUser: false },
      },
    ]);
    expect(await failedAi.service.tick()).toBe(false);
    expect(failedAi.posts).toHaveLength(1);
  });

  it('posts the fallback nudge when AI returns blank text', async () => {
    const blank = setup({
      latestHumanAt: new Date('2026-09-02T11:00:00.000Z'),
      channels: [{ channelId: testChannel, quietWindowMs: fiveMinutesMs }],
      aiText: '   ',
    });
    expect(await blank.service.tick()).toBe(true);
    expect(blank.posts).toEqual([
      {
        channelId: testChannel,
        content: fallbackNudge,
        allowedMentions: { parse: [], repliedUser: false },
      },
    ]);
  });

  it('neutralizes Discord mentions in composed nudge text', async () => {
    const mentioned = setup({
      latestHumanAt: new Date('2026-09-02T11:00:00.000Z'),
      channels: [{ channelId: testChannel, quietWindowMs: fiveMinutesMs }],
      aiText: 'Ping <@123456789012345678> and @everyone in this deck.',
    });
    expect(await mentioned.service.tick()).toBe(true);
    expect(mentioned.posts).toHaveLength(1);
    expect(mentioned.posts[0]?.content).not.toContain('<@123456789012345678>');
    expect(mentioned.posts[0]?.content).not.toMatch(/@everyone/);
    expect(mentioned.posts[0]?.allowedMentions).toEqual({
      parse: [],
      repliedUser: false,
    });
  });

  it('does not record a nudge when Discord delivery fails', async () => {
    const state = new Map<string, { lastHumanAt?: Date; lastNudgeAt?: Date }>([
      [testChannel, { lastHumanAt: new Date('2026-09-02T11:00:00.000Z') }],
    ]);
    const service = new QuietChannelNudgeService({
      store: {
        get: async (_guildId, channelId) => state.get(channelId),
        recordHumanMessage: async () => undefined,
        recordNudge: async (_guildId, channelId, at) => {
          state.set(channelId, {
            ...(state.get(channelId) ?? {}),
            lastNudgeAt: at,
          });
        },
      },
      gateway: {
        channelAvailable: async () => true,
        post: async () => {
          throw new Error('discord unavailable');
        },
      },
      ai: {
        respond: async () => ({ text: 'The MuthaShip channel is quiet.' }),
      },
      guildId: 'guild-1',
      channels: [{ channelId: testChannel, quietWindowMs: fiveMinutesMs }],
      isGloballyPaused: async () => false,
      now: () => new Date('2026-09-02T12:00:00.000Z'),
    });

    expect(await service.tick()).toBe(false);
    expect(state.get(testChannel)?.lastNudgeAt).toBeUndefined();
  });

  it('does not post while humans are still talking inside the quiet window', async () => {
    const active = setup({
      latestHumanAt: new Date('2026-09-02T11:58:00.000Z'),
      channels: [{ channelId: testChannel, quietWindowMs: fiveMinutesMs }],
    });
    expect(await active.service.tick()).toBe(false);
    expect(active.posts).toHaveLength(0);
  });

  it('runs scheduler ticks through the durable wrapper', async () => {
    const tick = vi.fn(async () => true);
    const scheduler = new DurableQuietChannelNudgeScheduler({ tick }, 10);
    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await scheduler.stop();
    expect(tick).toHaveBeenCalled();
  });
});
