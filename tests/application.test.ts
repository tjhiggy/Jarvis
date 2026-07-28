import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config/config.js';
import type { TrustedPersona } from '../src/config/persona.js';
import { createApplication } from '../src/index.js';

const config: AppConfig = {
  discord: { token: 'discord-token', clientId: 'client-id', guildId: 'guild-id' },
  openai: {
    apiKey: 'openai-key',
    model: 'test-model',
    timeoutMs: 1_000,
    maxRetries: 0,
  },
  storage: {
    databasePath: ':memory:',
    maxHistoryMessages: 5,
    historyRetentionDays: 30,
  },
  security: {
    allowedChannelIds: new Set(['channel-id']),
    maxInputChars: 100,
    rateLimitRequests: 2,
    rateLimitWindowMs: 1_000,
  },
  persona: {
    restrainedChannelIds: new Set(),
    promptPath: 'trusted-persona.md',
  },
  logging: { level: 'silent' },
};

describe('createApplication', () => {
  it('shuts down once, stopping event work before closing dependencies', async () => {
    const listeners = new Map<string, (...args: unknown[]) => unknown>();
    let closeCalls = 0;
    let destroyCalls = 0;
    let replyCalls = 0;
    let clearedTimer: unknown;
    const signalHandlers: Array<() => void | Promise<void>> = [];

    const application = await createApplication({
      loadConfig: () => config,
      loadPersona: async (path) => {
        expect(path).toBe('trusted-persona.md');
        return {} as TrustedPersona;
      },
      createStore: () => ({
        append: async () => undefined,
        getRecent: async () => [],
        clear: async () => 0,
        cleanup: async () => 0,
        healthCheck: async () => true,
        close: async () => {
          closeCalls += 1;
        },
      }),
      createAIService: () => ({ respond: async () => ({ text: 'unused' }) }),
      createDiscordClient: () => ({
        user: { id: 'bot-id' },
        on: (event, listener) => {
          listeners.set(event, listener);
        },
        login: async () => 'logged-in',
        destroy: () => {
          destroyCalls += 1;
        },
      }),
      timers: {
        setInterval: () => 'cleanup-timer',
        clearInterval: (timer) => {
          clearedTimer = timer;
        },
      },
      registerSignal: (_signal, handler) => {
        signalHandlers.push(handler);
      },
    });

    expect(signalHandlers).toHaveLength(2);
    const messageHandler = listeners.get('messageCreate');
    expect(messageHandler).toBeDefined();

    await Promise.all([application.shutdown(), application.shutdown()]);
    await messageHandler?.({
      id: 'message-id',
      content: '<@bot-id> hello',
      guildId: 'guild-id',
      channelId: 'channel-id',
      channel: {
        parentId: null,
        permissionsFor: () => ({ has: () => true }),
      },
      author: { id: 'user-id', bot: false },
      mentions: { users: { has: () => true } },
      reply: async () => {
        replyCalls += 1;
      },
    });

    expect(clearedTimer).toBe('cleanup-timer');
    expect(closeCalls).toBe(1);
    expect(destroyCalls).toBe(1);
    expect(replyCalls).toBe(0);
  });

  it('releases resources and sets a failing exit code when startup fails', async () => {
    let closeCalls = 0;
    let destroyCalls = 0;
    let exitCode: number | undefined;

    await expect(
      createApplication({
        loadConfig: () => config,
        loadPersona: async () => ({} as TrustedPersona),
        createStore: () => ({
          append: async () => undefined,
          getRecent: async () => [],
          clear: async () => 0,
          cleanup: async () => 0,
          healthCheck: async () => true,
          close: async () => {
            closeCalls += 1;
          },
        }),
        createAIService: () => ({ respond: async () => ({ text: 'unused' }) }),
        createDiscordClient: () => ({
          user: { id: 'bot-id' },
          on: () => undefined,
          login: async () => {
            throw new Error('login failed');
          },
          destroy: () => {
            destroyCalls += 1;
          },
        }),
        setExitCode: (code) => {
          exitCode = code;
        },
      }),
    ).rejects.toThrow('login failed');

    expect(closeCalls).toBe(1);
    expect(destroyCalls).toBe(1);
    expect(exitCode).toBe(1);
  });
});
