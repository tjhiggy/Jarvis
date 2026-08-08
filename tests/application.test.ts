import { GatewayIntentBits } from 'discord.js';
import { describe, expect, it } from 'vitest';
import type { Logger } from 'pino';
import type { AppConfig } from '../src/config/config.js';
import { loadPersona, type TrustedPersona } from '../src/config/persona.js';
import { discordGatewayIntents } from '../src/discord/handlers.js';
import type { FaqCatalog } from '../src/faq/faq-catalog.js';
import type { PollController } from '../src/polls/poll-controller.js';
import type { PollScheduler } from '../src/polls/poll-scheduler.js';
import type { PollStore } from '../src/polls/poll-store.js';
import { ReminderScheduler } from '../src/reminders/reminder-scheduler.js';
import type { ReminderStore } from '../src/reminders/reminder-store.js';
import type { ReminderView } from '../src/reminders/reminder-types.js';
import {
  createApplication,
  reportStartupFailure,
  type Application,
  type ApplicationDependencies,
} from '../src/index.js';

const config: AppConfig = {
  ai: { provider: 'openai' },
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
  ollama: {
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen3:8b',
    timeoutMs: 120_000,
    maxRetries: 1,
  },
  webSearch: {
    apiKey: '',
    timeoutMs: 10_000,
    cacheTtlMs: 3_600_000,
    maxResults: 5,
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
  faq: { catalogPath: 'faq.json' },
  polls: {
    enabled: false,
    adminUserIds: new Set(),
    voterSecret: '',
    retentionDays: 30,
    expiryCheckSeconds: 30,
  },
  engagement: {
    enabled: false,
    channels: {
      introductionId: '',
      suggestionId: '',
      eventId: '',
      recapId: '',
      activityId: '',
    },
    adminRoleIds: new Set(),
    recapSchedule: '',
    recapTimezone: 'UTC',
    retentionDays: 30,
    maxRecordsPerUser: 5,
    maxParticipants: 100,
  },
  logging: { level: 'silent' },
};

const testFaqCatalog: FaqCatalog = Object.freeze({
  entries: Object.freeze([
    Object.freeze({
      id: 'capabilities',
      label: 'Jarvis capabilities',
      question: 'What can Jarvis do?',
      answer: 'Jarvis answers approved questions.',
    }),
  ]),
  get: (id: string) =>
    id.trim().toLowerCase() === 'capabilities'
      ? {
          id: 'capabilities',
          label: 'Jarvis capabilities',
          question: 'What can Jarvis do?',
          answer: 'Jarvis answers approved questions.',
        }
      : undefined,
});

const createTestApplication = (
  dependencies: ApplicationDependencies = {},
): Promise<Application> =>
  createApplication({
    loadFaqCatalog: async () => testFaqCatalog,
    registerSignal: () => undefined,
    ...dependencies,
  });

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

  it('suppresses a newline-suffixed FAQ configuration lookalike', () => {
    const messages: string[] = [];

    reportStartupFailure(
      new Error('Invalid FAQ catalog configuration: FAQ_CATALOG_PATH\n'),
      (message) => {
        messages.push(message);
      },
    );

    expect(messages).toEqual(['Application startup failed.']);
  });
});

describe('createApplication', () => {
  it('opens reminder storage before login and constructs post-login runtime in order', async () => {
    const events: string[] = [];
    const gateway = {
      deliver: async () => ({ kind: 'delivered' as const }),
    };
    const scheduler = {
      healthy: true,
      start: () => {
        events.push('reminder-start');
      },
      stop: async () => {
        events.push('reminder-stop');
      },
    } as unknown as ReminderScheduler;

    const application = await createTestApplication({
      loadConfig: () => config,
      loadPersona: async () => ({}) as TrustedPersona,
      createStore: () => conversationStore(),
      createReminderStore: (path) => {
        events.push(`reminder-store:${path}`);
        return reminderStore();
      },
      createAIService: () => ({ respond: async () => ({ text: 'unused' }) }),
      createDiscordClient: () => {
        const client = {
          user: { id: 'bot-id' },
          on: (event: string) => {
            events.push(`listener:${event}`);
          },
          login: async () => {
            events.push('login');
          },
          destroy: () => undefined,
        };
        return client;
      },
      createReminderGateway: ({ allowedChannelIds }) => {
        events.push('reminder-gateway');
        expect(allowedChannelIds).toEqual(new Set(['channel-id']));
        return gateway;
      },
      createReminderScheduler: (dependencies) => {
        events.push('reminder-scheduler');
        expect(dependencies.store).toBeDefined();
        expect(dependencies.gateway).toBe(gateway);
        return scheduler;
      },
      timers: inertTimers(),
    });

    expect(events).toEqual([
      'reminder-store::memory:',
      'listener:messageCreate',
      'listener:interactionCreate',
      'login',
      'reminder-gateway',
      'reminder-scheduler',
      'reminder-start',
    ]);
    await application.shutdown();
  });

  it('runs startup recovery through the first real scheduler tick and narrow channel adapter', async () => {
    const events: string[] = [];
    const tickCompleted = deferred<void>();
    const storedReminder = reminder();
    const store = reminderStore({
      recoverExpiredClaims: async () => {
        events.push('recover');
        return 0;
      },
      claimDue: async () => {
        events.push('claim');
        return [storedReminder];
      },
      markDelivered: async () => {
        events.push('mark-delivered');
      },
      cleanup: async () => {
        events.push('reminder-cleanup');
        tickCompleted.resolve();
        return 0;
      },
    });

    const application = await createTestApplication({
      loadConfig: () => config,
      loadPersona: async () => ({}) as TrustedPersona,
      createStore: () => conversationStore(),
      createReminderStore: () => store,
      createAIService: () => ({ respond: async () => ({ text: 'unused' }) }),
      createDiscordClient: () => ({
        user: { id: 'bot-id' },
        channels: {
          fetch: async (channelId) => {
            events.push(`fetch:${channelId}`);
            return {
              id: channelId,
              guildId: 'guild-id',
              send: async () => {
                events.push('send');
              },
            };
          },
        },
        on: () => undefined,
        login: async () => {
          events.push('login');
        },
        destroy: () => undefined,
      }),
      createReminderScheduler: (dependencies) =>
        new ReminderScheduler({
          ...dependencies,
          now: () => new Date('2026-07-29T15:00:00.000Z'),
          createLeaseId: () => 'lease-id',
        }),
      timers: inertTimers(),
    });

    await tickCompleted.promise;
    expect(events).toEqual([
      'login',
      'recover',
      'claim',
      'fetch:channel-id',
      'send',
      'mark-delivered',
      'reminder-cleanup',
    ]);
    await application.shutdown();
  });

  it('uses a dedicated configured limiter for reminder commands and passes health dependencies', async () => {
    const listeners = new Map<string, (...args: unknown[]) => unknown>();
    let listCalls = 0;
    const store = reminderStore({
      listByOwner: async () => {
        listCalls += 1;
        return [];
      },
    });
    const application = await createTestApplication({
      loadConfig: () => config,
      loadPersona: async () => ({}) as TrustedPersona,
      createStore: () => conversationStore(),
      createReminderStore: () => store,
      createAIService: () => ({ respond: async () => ({ text: 'unused' }) }),
      createDiscordClient: () => ({
        user: { id: 'bot-id' },
        on: (event, listener) => {
          listeners.set(event, listener);
        },
        login: async () => undefined,
        destroy: () => undefined,
      }),
      createReminderGateway: () => ({
        deliver: async () => ({ kind: 'delivered' }),
      }),
      createReminderScheduler: () =>
        ({
          healthy: true,
          start: () => undefined,
          stop: async () => undefined,
        }) as unknown as ReminderScheduler,
      timers: inertTimers(),
    });

    const editMessages: string[] = [];
    for (let index = 1; index <= 3; index += 1) {
      const edited = deferred<void>();
      listeners.get('interactionCreate')?.(
        reminderListInteraction(`reminder-${index}`, (content) => {
          editMessages.push(content);
          edited.resolve();
        }),
      );
      await edited.promise;
    }

    expect(listCalls).toBe(2);
    expect(editMessages).toHaveLength(3);
    expect(editMessages[2]).toMatch(/too many reminder requests/i);
    await application.shutdown();
  });

  it('keeps the existing two guild intents with reminder delivery enabled', () => {
    expect(discordGatewayIntents).toEqual([
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
    ]);
  });

  it('does not construct poll resources while polls are disabled', async () => {
    let pollStoreCalls = 0;
    const application = await createTestApplication({
      loadConfig: () => config,
      loadPersona: async () => ({}) as TrustedPersona,
      createStore: () => conversationStore(),
      createAIService: () => ({ respond: async () => ({ text: 'unused' }) }),
      createPollStore: () => {
        pollStoreCalls += 1;
        return pollStore();
      },
      createDiscordClient: () => ({
        user: { id: 'bot-id' },
        on: () => undefined,
        login: async () => undefined,
        destroy: () => undefined,
      }),
    });

    expect(pollStoreCalls).toBe(0);
    await application.shutdown();
  });

  it('opens enabled polls on the configured database and starts maintenance only after login', async () => {
    const events: string[] = [];
    let pollStoreClosed = 0;
    const enabledConfig: AppConfig = {
      ...config,
      polls: {
        ...config.polls,
        enabled: true,
        adminUserIds: new Set(['12345678901234567']),
        voterSecret: 'a'.repeat(32),
      },
    };
    const application = await createTestApplication({
      loadConfig: () => enabledConfig,
      loadPersona: async () => ({}) as TrustedPersona,
      createStore: () => conversationStore(),
      createAIService: () => ({ respond: async () => ({ text: 'unused' }) }),
      createPollStore: (path) => {
        events.push(`poll-store:${path}`);
        return {
          ...pollStore(),
          closeConnection: async () => {
            pollStoreClosed += 1;
          },
          listPendingSync: async () => [],
          closeDue: async () => [],
        };
      },
      createDiscordClient: () => ({
        user: { id: 'bot-id' },
        on: () => undefined,
        login: async () => {
          events.push('login');
        },
        destroy: () => undefined,
      }),
      timers: {
        setInterval: () => {
          events.push('timer');
          return 'timer';
        },
        clearInterval: () => undefined,
      },
    });

    expect(events).toEqual([
      'poll-store::memory:',
      'login',
      'timer',
      'timer',
      'timer',
    ]);
    await application.shutdown();
    expect(pollStoreClosed).toBe(1);
  });

  it('reconciles stranded poll reservations before Discord login without touching messages', async () => {
    const events: string[] = [];
    const enabledConfig: AppConfig = {
      ...config,
      polls: {
        ...config.polls,
        enabled: true,
        adminUserIds: new Set(['12345678901234567']),
        voterSecret: 'a'.repeat(32),
      },
    };
    const application = await createTestApplication({
      loadConfig: () => enabledConfig,
      loadPersona: async () => ({}) as TrustedPersona,
      createStore: () => conversationStore(),
      createAIService: () => ({ respond: async () => ({ text: 'unused' }) }),
      createPollStore: () => ({
        ...pollStore(),
        recoverCreating: async () => {
          events.push('recover-creating');
          return 1;
        },
      }),
      createDiscordClient: () => ({
        user: { id: 'bot-id' },
        on: () => undefined,
        login: async () => {
          events.push('login');
        },
        destroy: () => undefined,
      }),
    });

    expect(events).toEqual(['recover-creating', 'login']);
    await application.shutdown();
  });

  it('finishes loading the configured FAQ catalog before starting resources or Discord login', async () => {
    const events: string[] = [];
    const catalogStarted = deferred<void>();
    const releaseCatalog = deferred<void>();

    const starting = createTestApplication({
      loadConfig: () => config,
      loadPersona: async (path) => {
        events.push(`persona:${path}`);
        return {} as TrustedPersona;
      },
      loadFaqCatalog: async (path) => {
        events.push(`faq:${path}:started`);
        catalogStarted.resolve();
        await releaseCatalog.promise;
        events.push('faq:completed');
        return testFaqCatalog;
      },
      createStore: () => {
        events.push('store');
        return {
          append: async () => undefined,
          getRecent: async () => [],
          clear: async () => 0,
          cleanup: async () => {
            events.push('cleanup');
            return 0;
          },
          healthCheck: async () => true,
          close: async () => undefined,
        };
      },
      createAIService: () => {
        events.push('ai');
        return { respond: async () => ({ text: 'unused' }) };
      },
      createDiscordClient: () => {
        events.push('client');
        return {
          user: { id: 'bot-id' },
          on: () => undefined,
          login: async () => {
            events.push('login');
          },
          destroy: () => undefined,
        };
      },
    });

    await catalogStarted.promise;
    expect(events).toEqual([
      'persona:trusted-persona.md',
      'faq:faq.json:started',
    ]);

    releaseCatalog.resolve();
    const application = await starting;
    expect(events).toEqual([
      'persona:trusted-persona.md',
      'faq:faq.json:started',
      'faq:completed',
      'store',
      'ai',
      'client',
      'login',
      'cleanup',
    ]);
    await application.shutdown();
  });

  it('stops startup safely when the trusted FAQ catalog cannot be loaded', async () => {
    const faqError = new Error(
      'Invalid FAQ catalog configuration: FAQ_CATALOG_PATH',
    );
    const messages: string[] = [];
    let storeFactoryCalls = 0;
    let aiFactoryCalls = 0;
    let clientFactoryCalls = 0;
    let loginCalls = 0;
    let exitCode: number | undefined;

    await expect(
      createTestApplication({
        loadConfig: () => config,
        loadPersona: async () => ({}) as TrustedPersona,
        loadFaqCatalog: async () => {
          throw faqError;
        },
        createStore: () => {
          storeFactoryCalls += 1;
          throw new Error('store factory must not run');
        },
        createAIService: () => {
          aiFactoryCalls += 1;
          throw new Error('AI factory must not run');
        },
        createDiscordClient: () => {
          clientFactoryCalls += 1;
          return {
            user: { id: 'bot-id' },
            on: () => undefined,
            login: async () => {
              loginCalls += 1;
            },
            destroy: () => undefined,
          };
        },
        setExitCode: (code) => {
          exitCode = code;
        },
      }),
    ).rejects.toBe(faqError);

    reportStartupFailure(faqError, (message) => {
      messages.push(message);
    });
    expect(storeFactoryCalls).toBe(0);
    expect(aiFactoryCalls).toBe(0);
    expect(clientFactoryCalls).toBe(0);
    expect(loginCalls).toBe(0);
    expect(exitCode).toBe(1);
    expect(messages).toEqual([
      'Invalid FAQ catalog configuration: FAQ_CATALOG_PATH',
    ]);
  });

  it('projects FAQ catalog startup failures without path, content, or parser telemetry', async () => {
    const telemetry: Array<{
      context: Record<string, unknown>;
      message: string;
    }> = [];
    const elapsedTimes = [200, 240];
    const faqError = Object.assign(
      new Error(
        'Unexpected token in C:\\private\\faq.json near approved answer text',
      ),
      { code: 'FAQ_PARSE_FAILED:C:\\private\\faq.json' },
    );

    await expect(
      createTestApplication({
        loadConfig: () => config,
        loadPersona: async () => ({}) as TrustedPersona,
        loadFaqCatalog: async () => {
          throw faqError;
        },
        createLogger: () =>
          ({
            info: () => undefined,
            warn: () => undefined,
            error: (
              context: Record<string, unknown>,
              message: string,
            ): void => {
              telemetry.push({ context, message });
            },
          }) as unknown as Logger,
        elapsedNow: () => elapsedTimes.shift() ?? 240,
      }),
    ).rejects.toBe(faqError);

    expect(telemetry).toEqual([
      {
        context: {
          elapsedMs: 40,
          errorClass: 'Error',
          errorCategory: 'startup',
        },
        message: 'Application startup failed.',
      },
    ]);
    expect(JSON.stringify(telemetry)).not.toMatch(
      /private|faq\.json|approved answer|unexpected token|parse failed/i,
    );
  });

  it('shuts down once, stopping event work before closing dependencies', async () => {
    const listeners = new Map<string, (...args: unknown[]) => unknown>();
    let closeCalls = 0;
    let destroyCalls = 0;
    let replyCalls = 0;
    let cleanupCalls = 0;
    let clearedTimer: unknown;
    const signalHandlers: Array<() => void | Promise<void>> = [];

    const application = await createTestApplication({
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

  it('shuts down reminder and poll resources once in the exact dependency order', async () => {
    const events: string[] = [];
    const listeners = new Map<string, (...args: unknown[]) => unknown>();
    let reminderListCalls = 0;
    const enabledConfig: AppConfig = {
      ...config,
      polls: {
        ...config.polls,
        enabled: true,
        adminUserIds: new Set(['12345678901234567']),
        voterSecret: 'a'.repeat(32),
      },
    };
    const application = await createTestApplication({
      loadConfig: () => enabledConfig,
      loadPersona: async () => ({}) as TrustedPersona,
      createStore: () => ({
        ...conversationStore(),
        close: async () => {
          events.push('conversation-store-close');
        },
      }),
      createReminderStore: () =>
        reminderStore({
          listByOwner: async () => {
            reminderListCalls += 1;
            return [];
          },
          closeConnection: async () => {
            events.push('reminder-store-close');
          },
        }),
      createPollStore: () => ({
        ...pollStore(),
        closeConnection: async () => {
          events.push('poll-store-close');
        },
      }),
      createAIService: () => ({ respond: async () => ({ text: 'unused' }) }),
      createDiscordClient: () => ({
        user: { id: 'bot-id' },
        on: (event, listener) => {
          listeners.set(event, listener);
        },
        login: async () => undefined,
        destroy: () => {
          events.push('discord-destroy');
        },
      }),
      createPollController: () => inertPollController(),
      createPollScheduler: () =>
        ({
          start: () => undefined,
          stop: async () => {
            events.push('poll-scheduler-stop');
          },
          healthy: true,
        }) as unknown as PollScheduler,
      createReminderGateway: () => ({
        deliver: async () => ({ kind: 'delivered' }),
      }),
      createReminderScheduler: () =>
        ({
          healthy: true,
          start: () => undefined,
          stop: async () => {
            events.push('reminder-scheduler-stop');
            listeners.get('interactionCreate')?.(
              reminderListInteraction('during-shutdown', () => undefined),
            );
          },
        }) as unknown as ReminderScheduler,
      timers: inertTimers(),
    });

    events.length = 0;
    await Promise.all([application.shutdown(), application.shutdown()]);

    expect(reminderListCalls).toBe(0);
    expect(events).toEqual([
      'reminder-scheduler-stop',
      'poll-scheduler-stop',
      'reminder-store-close',
      'poll-store-close',
      'conversation-store-close',
      'discord-destroy',
    ]);
  });

  it('cleans reminder resources when scheduler startup fails', async () => {
    const events: string[] = [];
    let exitCode: number | undefined;
    const startupError = new Error('scheduler start failed');

    await expect(
      createTestApplication({
        loadConfig: () => config,
        loadPersona: async () => ({}) as TrustedPersona,
        createStore: () => ({
          ...conversationStore(),
          close: async () => {
            events.push('conversation-store-close');
          },
        }),
        createReminderStore: () =>
          reminderStore({
            closeConnection: async () => {
              events.push('reminder-store-close');
            },
          }),
        createAIService: () => ({
          respond: async () => ({ text: 'unused' }),
        }),
        createDiscordClient: () => ({
          user: { id: 'bot-id' },
          on: () => undefined,
          login: async () => undefined,
          destroy: () => {
            events.push('discord-destroy');
          },
        }),
        createReminderGateway: () => ({
          deliver: async () => ({ kind: 'delivered' }),
        }),
        createReminderScheduler: () =>
          ({
            healthy: true,
            start: () => {
              events.push('reminder-start');
              throw startupError;
            },
            stop: async () => {
              events.push('reminder-scheduler-stop');
            },
          }) as unknown as ReminderScheduler,
        timers: inertTimers(),
        setExitCode: (code) => {
          exitCode = code;
        },
      }),
    ).rejects.toBe(startupError);

    expect(events).toEqual([
      'reminder-start',
      'reminder-scheduler-stop',
      'reminder-store-close',
      'conversation-store-close',
      'discord-destroy',
    ]);
    expect(exitCode).toBe(1);
  });

  it('sanitizes reminder shutdown failures and continues closing resources', async () => {
    const warnings: Array<{
      context: Record<string, unknown>;
      message: string;
    }> = [];
    const events: string[] = [];
    const internalDetail = 'C:\\private\\reminders.db token=secret';
    const application = await createTestApplication({
      loadConfig: () => config,
      loadPersona: async () => ({}) as TrustedPersona,
      createStore: () => ({
        ...conversationStore(),
        close: async () => {
          events.push('conversation-store-close');
        },
      }),
      createReminderStore: () =>
        reminderStore({
          closeConnection: async () => {
            throw new Error(internalDetail);
          },
        }),
      createAIService: () => ({ respond: async () => ({ text: 'unused' }) }),
      createDiscordClient: () => ({
        user: { id: 'bot-id' },
        on: () => undefined,
        login: async () => undefined,
        destroy: () => {
          events.push('discord-destroy');
        },
      }),
      createReminderGateway: () => ({
        deliver: async () => ({ kind: 'delivered' }),
      }),
      createReminderScheduler: () =>
        ({
          healthy: true,
          start: () => undefined,
          stop: async () => {
            throw new Error(internalDetail);
          },
        }) as unknown as ReminderScheduler,
      createLogger: () =>
        ({
          info: () => undefined,
          error: () => undefined,
          warn: (context: Record<string, unknown>, message: string): void => {
            warnings.push({ context, message });
          },
        }) as unknown as Logger,
      timers: inertTimers(),
    });

    await application.shutdown();

    expect(warnings).toEqual([
      {
        context: {
          errorClass: 'Error',
          errorCategory: 'reminder_scheduler_shutdown',
        },
        message: 'Reminder scheduler stop failed during shutdown.',
      },
      {
        context: {
          errorClass: 'Error',
          errorCategory: 'reminder_storage_shutdown',
        },
        message: 'Reminder storage close failed during shutdown.',
      },
    ]);
    expect(events).toEqual(['conversation-store-close', 'discord-destroy']);
    expect(JSON.stringify(warnings)).not.toContain(internalDetail);
  });

  it('runs startup cleanup after Discord login and accepts events immediately after ready', async () => {
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

    const starting = createTestApplication({
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
    expect(loginCalls).toBe(1);
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

    const application = await createTestApplication({
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
          info: () => undefined,
          warn: () => {
            warningCalls += 1;
            if (warningCalls === 2) {
              releaseWarning();
            }
          },
          error: () => undefined,
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

  it('deduplicates repeated slash-command interactions through the real command handler', async () => {
    const listeners = new Map<string, (...args: unknown[]) => unknown>();
    const appendedRoles: string[] = [];
    const editedReplies: string[] = [];
    let aiCalls = 0;
    const firstEdit = deferred<void>();
    const secondEdit = deferred<void>();

    const application = await createTestApplication({
      loadConfig: () => config,
      loadPersona: async () => loadPersona('config/jarvis-persona.md'),
      createStore: () => ({
        append: async (message) => {
          appendedRoles.push(message.role);
        },
        getRecent: async () => [],
        clear: async () => 0,
        cleanup: async () => 0,
        healthCheck: async () => true,
        close: async () => undefined,
      }),
      createAIService: () => ({
        respond: async () => {
          aiCalls += 1;
          return { text: 'One completed answer.' };
        },
      }),
      createDiscordClient: () => ({
        user: { id: 'bot-id' },
        on: (event, listener) => {
          listeners.set(event, listener);
        },
        login: async () => 'logged-in',
        destroy: () => undefined,
      }),
    });
    const interaction = {
      isChatInputCommand: () => true,
      id: 'interaction-duplicate',
      commandName: 'ask',
      guildId: 'guild-id',
      channelId: 'channel-id',
      channel: { parentId: null, isThread: () => false },
      user: { id: 'user-id' },
      options: {
        getString: (name: string) =>
          name === 'prompt' ? 'Answer exactly once.' : null,
      },
      deferReply: async () => undefined,
      reply: async () => undefined,
      editReply: async (payload: { content: string }) => {
        editedReplies.push(payload.content);
        if (editedReplies.length === 1) {
          firstEdit.resolve();
        }
        if (editedReplies.length === 2) {
          secondEdit.resolve();
        }
      },
      followUp: async () => undefined,
    };

    listeners.get('interactionCreate')?.(interaction);
    await firstEdit.promise;
    listeners.get('interactionCreate')?.(interaction);
    await secondEdit.promise;

    expect(aiCalls).toBe(1);
    expect(appendedRoles).toEqual(['user', 'assistant']);
    expect(editedReplies).toEqual([
      'One completed answer.',
      expect.stringMatching(/already.*handled/i),
    ]);
    await application.shutdown();
  });

  it('releases resources and sets a failing exit code when startup fails', async () => {
    let closeCalls = 0;
    let destroyCalls = 0;
    let exitCode: number | undefined;

    await expect(
      createTestApplication({
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

  it('logs sanitized startup failure telemetry with elapsed time and no error message', async () => {
    const telemetry: Array<{
      context: Record<string, unknown>;
      message: string;
    }> = [];
    const elapsedTimes = [500, 560];
    const startupError = Object.assign(
      new Error('discord token=super-secret failed'),
      { code: 'DISCORD_AUTHENTICATION_FAILED' },
    );

    await expect(
      createTestApplication({
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
        createAIService: () => ({ respond: async () => ({ text: 'unused' }) }),
        createDiscordClient: () => ({
          user: { id: 'bot-id' },
          on: () => undefined,
          login: async () => {
            throw startupError;
          },
          destroy: () => undefined,
        }),
        createLogger: () =>
          ({
            info: () => undefined,
            warn: () => undefined,
            error: (
              context: Record<string, unknown>,
              message: string,
            ): void => {
              telemetry.push({ context, message });
            },
          }) as unknown as Logger,
        elapsedNow: () => elapsedTimes.shift() ?? 560,
      }),
    ).rejects.toBe(startupError);

    expect(telemetry).toEqual([
      {
        context: {
          elapsedMs: 60,
          errorClass: 'Error',
          errorCode: 'DISCORD_AUTHENTICATION_FAILED',
          errorCategory: 'startup',
        },
        message: 'Application startup failed.',
      },
    ]);
    expect(JSON.stringify(telemetry)).not.toMatch(/super-secret|token=/);
  });
});

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve: ((value: T | PromiseLike<T>) => void) | undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  if (resolve === undefined) {
    throw new Error('Deferred promise initialization failed.');
  }
  return { promise, resolve };
}

function conversationStore() {
  return {
    append: async () => undefined,
    getRecent: async () => [],
    clear: async () => 0,
    cleanup: async () => 0,
    healthCheck: async () => true,
    close: async () => undefined,
  };
}

function pollStore(): PollStore {
  return {
    reserve: async () => {
      throw new Error('unused');
    },
    get: async () => undefined,
    activate: async () => {
      throw new Error('unused');
    },
    markFailed: async () => undefined,
    recordVote: async () => {
      throw new Error('unused');
    },
    close: async () => {
      throw new Error('unused');
    },
    closeDue: async () => [],
    markPendingSync: async () => undefined,
    markSynced: async () => undefined,
    markOrphaned: async () => undefined,
    listPendingSync: async () => [],
    recoverCreating: async () => 0,
    countCapacityOccupying: async () => 0,
    hasActiveByCreatorInConversation: async () => false,
    cleanup: async () => 0,
    healthCheck: async () => true,
    closeConnection: async () => undefined,
  };
}

function reminderStore(overrides: Partial<ReminderStore> = {}): ReminderStore {
  return {
    create: async (input) => ({
      ...input,
      status: 'pending',
      attemptCount: 0,
    }),
    listByOwner: async () => [],
    cancelOwned: async () => undefined,
    recoverExpiredClaims: async () => 0,
    claimDue: async () => [],
    markDelivered: async () => undefined,
    markRetry: async () => undefined,
    markFailed: async () => undefined,
    markDeliveryUncertain: async () => undefined,
    cleanup: async () => 0,
    statusCounts: async () => ({
      pending: 0,
      retryPending: 0,
      deliveryUncertain: 0,
      failed: 0,
    }),
    healthCheck: async () => true,
    closeConnection: async () => undefined,
    ...overrides,
  };
}

function reminder(overrides: Partial<ReminderView> = {}): ReminderView {
  return {
    id: 'abcdef234567',
    guildId: 'guild-id',
    channelId: 'channel-id',
    ownerUserId: 'user-id',
    message: 'Check the oven',
    dueAt: new Date('2026-07-29T15:00:00.000Z'),
    status: 'pending',
    attemptCount: 0,
    createdAt: new Date('2026-07-29T14:00:00.000Z'),
    ...overrides,
  };
}

function inertTimers(): NonNullable<ApplicationDependencies['timers']> {
  return {
    setInterval: () => 'timer',
    clearInterval: () => undefined,
  };
}

function reminderListInteraction(
  id: string,
  edited: (content: string) => void,
) {
  return {
    isChatInputCommand: () => true,
    isButton: () => false,
    id,
    commandName: 'reminder',
    guildId: 'guild-id',
    channelId: 'channel-id',
    channel: { parentId: null, isThread: () => false },
    user: { id: 'user-id' },
    options: {
      getSubcommand: () => 'list',
      getString: () => null,
    },
    deferReply: async () => undefined,
    fetchReply: async () => ({ id: 'reply-id' }),
    reply: async () => undefined,
    editReply: async (payload: { content?: string }) => {
      edited(payload.content ?? '');
    },
    followUp: async () => undefined,
  };
}

function inertPollController(): PollController {
  return {
    create: async () => undefined,
    vote: async () => undefined,
    close: async () => undefined,
    synchronize: async () => undefined,
  };
}
