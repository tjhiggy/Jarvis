import { describe, expect, it } from 'vitest';
import type { Logger } from 'pino';
import type { AppConfig } from '../src/config/config.js';
import type { TrustedPersona } from '../src/config/persona.js';
import { createApplication, reportStartupFailure } from '../src/index.js';

const config: AppConfig = {
  discord: {
    token: 'discord-token',
    clientId: 'client-id',
    guildId: 'guild-id',
  },
  openai: {
    apiKey: 'openai-key',
    model: 'test-model',
    timeoutMs: 1_000,
    maxRetries: 0,
  },
  storage: {
    databasePath: ':memory:',
    maxHistoryMessages: 5,
    maxStoredMessages: 100,
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

describe('reportStartupFailure', () => {
  it('surfaces safe configuration names and suppresses arbitrary error details', () => {
    const messages: string[] = [];
    const write = (message: string): void => {
      messages.push(message);
    };

    reportStartupFailure(
      new Error(
        'Invalid environment configuration: DISCORD_TOKEN, OPENAI_API_KEY',
      ),
      write,
    );
    reportStartupFailure(
      new Error('startup failed with discord-token-secret'),
      write,
    );

    expect(messages).toEqual([
      'Invalid environment configuration: DISCORD_TOKEN, OPENAI_API_KEY',
      'Application startup failed.',
    ]);
    expect(messages.join('\n')).not.toContain('discord-token-secret');
  });
});

describe('createApplication', () => {
  it('shuts down once, stopping event work before closing dependencies', async () => {
    const listeners = new Map<string, (...args: unknown[]) => unknown>();
    let closeCalls = 0;
    let destroyCalls = 0;
    let replyCalls = 0;
    let cleanupCalls = 0;
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
        cleanup: async () => {
          cleanupCalls += 1;
          return 0;
        },
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
    expect(cleanupCalls).toBe(1);
    expect(closeCalls).toBe(1);
    expect(destroyCalls).toBe(1);
    expect(replyCalls).toBe(0);
  });

  it('finishes startup cleanup before login and accepts events immediately after ready', async () => {
    const listeners = new Map<string, (...args: unknown[]) => unknown>();
    let releaseCleanup = (): void => undefined;
    let signalCleanupStarted = (): void => undefined;
    const cleanupStarted = new Promise<void>((resolve) => {
      signalCleanupStarted = resolve;
    });
    let clientUser: Readonly<{ id: string }> | null = null;
    let loginCalls = 0;
    let listenersBoundBeforeLogin = false;
    let replyCalls = 0;
    let releaseReply = (): void => undefined;
    const replyObserved = new Promise<void>((resolve) => {
      releaseReply = resolve;
    });
    const message = {
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
        releaseReply();
      },
    };

    const starting = createApplication({
      loadConfig: () => config,
      loadPersona: async () => ({}) as TrustedPersona,
      createStore: () => ({
        append: async () => undefined,
        getRecent: async () => [],
        clear: async () => 0,
        cleanup: async () => {
          signalCleanupStarted();
          await new Promise<void>((resolve) => {
            releaseCleanup = resolve;
          });
          return 0;
        },
        healthCheck: async () => true,
        close: async () => undefined,
      }),
      createAIService: () => ({ respond: async () => ({ text: 'unused' }) }),
      createDiscordClient: () => ({
        get user() {
          return clientUser;
        },
        on: (event, listener) => {
          listeners.set(event, listener);
        },
        login: async () => {
          loginCalls += 1;
          listenersBoundBeforeLogin = listeners.has('messageCreate');
          clientUser = { id: 'bot-id' };
        },
        destroy: () => undefined,
      }),
    });

    await cleanupStarted;
    expect(loginCalls).toBe(0);
    releaseCleanup();
    const application = await starting;
    expect(loginCalls).toBe(1);
    expect(listenersBoundBeforeLogin).toBe(true);
    const messageHandler = listeners.get('messageCreate');
    expect(messageHandler).toBeDefined();
    messageHandler?.(message);
    await replyObserved;
    expect(replyCalls).toBe(1);
    await application.shutdown();
  });

  it('contains rejected Discord event handlers at the listener boundary', async () => {
    const listeners = new Map<string, (...args: unknown[]) => unknown>();
    let warningCalls = 0;
    let releaseWarning = (): void => undefined;
    const warningLogged = new Promise<void>((resolve) => {
      releaseWarning = resolve;
    });

    const application = await createApplication({
      loadConfig: () => config,
      loadPersona: async () => ({}) as TrustedPersona,
      createStore: () => ({
        append: async () => undefined,
        getRecent: async () => [],
        clear: async () => 0,
        cleanup: async () => 0,
        healthCheck: async () => true,
        close: async () => undefined,
      }),
      createAIService: () => ({
        respond: async () => ({ text: 'completed response' }),
      }),
      createDiscordClient: () => ({
        user: { id: 'bot-id' },
        on: (event, listener) => {
          listeners.set(event, listener);
        },
        login: async () => 'logged-in',
        destroy: () => undefined,
      }),
      createLogger: () =>
        ({
          warn: () => {
            warningCalls += 1;
            if (warningCalls === 2) {
              releaseWarning();
            }
          },
        }) as unknown as Logger,
    });

    const listenerResult = listeners.get('messageCreate')?.({
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
        throw new Error('message was deleted');
      },
    });
    if (listenerResult instanceof Promise) {
      void listenerResult.catch(() => undefined);
    }
    const interactionResult = listeners.get('interactionCreate')?.({
      isChatInputCommand: () => true,
      commandName: 'help',
      reply: async () => {
        throw new Error('interaction token expired');
      },
    });
    if (interactionResult instanceof Promise) {
      void interactionResult.catch(() => undefined);
    }

    expect(listenerResult).toBeUndefined();
    expect(interactionResult).toBeUndefined();
    await warningLogged;
    expect(warningCalls).toBe(2);
    await application.shutdown();
  });

  it('releases resources and sets a failing exit code when startup fails', async () => {
    let closeCalls = 0;
    let destroyCalls = 0;
    let exitCode: number | undefined;

    await expect(
      createApplication({
        loadConfig: () => config,
        loadPersona: async () => ({}) as TrustedPersona,
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
