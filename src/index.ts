import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { Client } from 'discord.js';
import OpenAI from 'openai';
import type { Logger } from 'pino';
import { handleCommand, type CommandInteraction } from './commands/handlers.js';
import { loadConfig, type AppConfig } from './config/config.js';
import { loadPersona, type TrustedPersona } from './config/persona.js';
import {
  createDiscordHandlers,
  discordGatewayIntents,
  type DiscordInteraction,
  type DiscordMessage,
} from './discord/handlers.js';
import { loadFaqCatalog, type FaqCatalog } from './faq/faq-catalog.js';
import {
  OpenAIResponsesService,
  type AIService,
} from './openai/openai-service.js';
import { OllamaChatService } from './ollama/ollama-service.js';
import {
  TavilySearchService,
  WebGroundedAIService,
} from './search/web-search.js';
import { EventDeduplicator } from './security/event-deduplicator.js';
import { RateLimiter } from './security/rate-limiter.js';
import { ConversationService } from './services/conversation-service.js';
import type { ConversationStore } from './storage/conversation-store.js';
import { SQLiteConversationStore } from './storage/sqlite-conversation-store.js';
import {
  DiscordPollController,
  type PollController,
} from './polls/poll-controller.js';
import {
  DiscordPollMessageGateway,
  type PollChannelTarget,
} from './polls/poll-message-gateway.js';
import { DurablePollService, type PollService } from './polls/poll-service.js';
import { PollScheduler } from './polls/poll-scheduler.js';
import type { PollStore } from './polls/poll-store.js';
import { SQLitePollStore } from './polls/sqlite-poll-store.js';
import { createLogger, projectOperationalError } from './utils/logger.js';

const cleanupIntervalMs = 24 * 60 * 60 * 1_000;
const safeConfigurationError =
  /^Invalid environment configuration: (?:[A-Z][A-Z0-9_]*|unknown)(?:, (?:[A-Z][A-Z0-9_]*|unknown))*$/;
const safeFaqConfigurationErrorMessage =
  'Invalid FAQ catalog configuration: FAQ_CATALOG_PATH';
let dotenvLoaded = false;

interface RuntimeDiscordClient {
  readonly user: Readonly<{ id: string }> | null;
  readonly channels?: Readonly<{
    fetch(channelId: string): Promise<unknown>;
  }>;
  on(event: string, listener: (...args: unknown[]) => unknown): unknown;
  login(token: string): Promise<unknown>;
  destroy(): void;
}

export interface ApplicationTimers {
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface ApplicationDependencies {
  readonly loadEnvironment?: () => unknown;
  readonly loadConfig?: (env: NodeJS.ProcessEnv) => AppConfig;
  readonly loadPersona?: (path: string) => Promise<TrustedPersona>;
  readonly loadFaqCatalog?: (path: string) => Promise<FaqCatalog>;
  readonly createStore?: (
    databasePath: string,
    maxStoredMessages: number,
  ) => ConversationStore;
  readonly createPollStore?: (databasePath: string) => PollStore;
  readonly createPollController?: (
    dependencies: Readonly<{
      service: PollService;
      client: RuntimeDiscordClient;
      botUserId: string;
      logger: Logger;
    }>,
  ) => PollController;
  readonly createPollScheduler?: (
    dependencies: Readonly<{
      service: PollService;
      store: PollStore;
      controller: PollController;
      retentionDays: number;
      intervalMs: number;
      timers: ApplicationTimers;
      logger: Logger;
    }>,
  ) => PollScheduler;
  readonly createAIService?: (config: AppConfig) => AIService;
  readonly createDiscordClient?: () => RuntimeDiscordClient;
  readonly createLogger?: (level: string) => Logger;
  readonly timers?: ApplicationTimers;
  readonly registerSignal?: (
    signal: NodeJS.Signals,
    handler: () => void | Promise<void>,
  ) => void;
  readonly setExitCode?: (code: number) => void;
  readonly elapsedNow?: () => number;
}

export interface Application {
  readonly shutdown: () => Promise<void>;
}

const systemTimers: ApplicationTimers = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

const loadEnvironmentOnce = (): void => {
  if (!dotenvLoaded) {
    dotenv.config();
    dotenvLoaded = true;
  }
};

const createDefaultAIService = (config: AppConfig): AIService => {
  let ai: AIService;
  if (config.ai.provider === 'ollama') {
    ai = new OllamaChatService({
      baseUrl: config.ollama.baseUrl,
      model: config.ollama.model,
      timeoutMs: config.ollama.timeoutMs,
      maxRetries: config.ollama.maxRetries,
      maxOutputTokens: 1_000,
    });
  } else {
    ai = new OpenAIResponsesService({
      client: new OpenAI({
        apiKey: config.openai.apiKey,
        timeout: config.openai.timeoutMs,
        maxRetries: config.openai.maxRetries,
      }),
      model: config.openai.model,
      timeoutMs: config.openai.timeoutMs,
      maxRetries: config.openai.maxRetries,
      maxOutputTokens: 1_000,
    });
  }

  if (config.webSearch.apiKey === '') {
    return ai;
  }
  return new WebGroundedAIService({
    ai,
    search: new TavilySearchService({
      apiKey: config.webSearch.apiKey,
      timeoutMs: config.webSearch.timeoutMs,
      cacheTtlMs: config.webSearch.cacheTtlMs,
      maxResults: config.webSearch.maxResults,
    }),
  });
};

const createDefaultDiscordClient = (): RuntimeDiscordClient =>
  new Client({
    intents: discordGatewayIntents,
  }) as unknown as RuntimeDiscordClient;

const createDefaultPollController = (
  dependencies: Readonly<{
    service: PollService;
    client: RuntimeDiscordClient;
    botUserId: string;
    logger: Logger;
  }>,
): PollController =>
  new DiscordPollController({
    service: dependencies.service,
    gateway: new DiscordPollMessageGateway({
      botUserId: dependencies.botUserId,
      fetchChannel: async (channelId) => {
        const channel = await dependencies.client.channels?.fetch(channelId);
        return isPollChannelTarget(channel) ? channel : undefined;
      },
    }),
    logger: dependencies.logger,
  });

const isPollChannelTarget = (value: unknown): value is PollChannelTarget =>
  typeof value === 'object' &&
  value !== null &&
  'messages' in value &&
  typeof (value as { readonly messages?: unknown }).messages === 'object';

const registerProcessSignal = (
  signal: NodeJS.Signals,
  handler: () => void | Promise<void>,
): void => {
  process.once(signal, () => {
    void handler();
  });
};

/**
 * Builds and starts the application. Dependency injection keeps the lifecycle
 * observable without requiring credentials or a Discord connection in tests.
 */
export const createApplication = async (
  dependencies: ApplicationDependencies = {},
): Promise<Application> => {
  const loadEnvironment = dependencies.loadEnvironment ?? loadEnvironmentOnce;
  const configLoader = dependencies.loadConfig ?? loadConfig;
  const personaLoader = dependencies.loadPersona ?? loadPersona;
  const faqCatalogLoader = dependencies.loadFaqCatalog ?? loadFaqCatalog;
  const storeFactory =
    dependencies.createStore ??
    ((path, maxStoredMessages) =>
      new SQLiteConversationStore(path, maxStoredMessages));
  const aiFactory = dependencies.createAIService ?? createDefaultAIService;
  const discordFactory =
    dependencies.createDiscordClient ?? createDefaultDiscordClient;
  const loggerFactory = dependencies.createLogger ?? createLogger;
  const timers = dependencies.timers ?? systemTimers;
  const registerSignal = dependencies.registerSignal ?? registerProcessSignal;
  const setExitCode =
    dependencies.setExitCode ??
    ((code) => {
      process.exitCode = code;
    });
  const elapsedNow = dependencies.elapsedNow ?? (() => performance.now());
  const startupStartedAt = elapsedNow();

  let logger: Logger | undefined;
  let store: ConversationStore | undefined;
  let pollStore: PollStore | undefined;
  let pollScheduler: PollScheduler | undefined;
  let client: RuntimeDiscordClient | undefined;
  let cleanupTimer: unknown;
  let acceptingWork = false;
  let shutdownPromise: Promise<void> | undefined;

  const shutdown = (): Promise<void> => {
    acceptingWork = false;
    shutdownPromise ??= (async () => {
      if (cleanupTimer !== undefined) {
        timers.clearInterval(cleanupTimer);
        cleanupTimer = undefined;
      }

      if (pollScheduler !== undefined) {
        try {
          await pollScheduler.stop();
        } catch (error) {
          logger?.warn(
            { error },
            'Poll scheduler stop failed during shutdown.',
          );
        }
      }

      if (pollStore !== undefined) {
        try {
          await pollStore.closeConnection();
        } catch (error) {
          logger?.warn({ error }, 'Poll storage close failed during shutdown.');
        }
      }

      if (store !== undefined) {
        try {
          await store.close();
        } catch (error) {
          logger?.warn({ error }, 'Storage close failed during shutdown.');
        }
      }

      if (client !== undefined) {
        try {
          client.destroy();
        } catch (error) {
          logger?.warn(
            { error },
            'Discord client destroy failed during shutdown.',
          );
        }
      }
    })();
    return shutdownPromise;
  };

  try {
    loadEnvironment();
    const config = configLoader(process.env);
    logger = loggerFactory(config.logging.level);
    const persona = await personaLoader(config.persona.promptPath);
    const faq = await faqCatalogLoader(config.faq.catalogPath);
    store = storeFactory(
      config.storage.databasePath,
      config.storage.maxStoredMessages,
    );
    const initializedStore = store;
    const ai = aiFactory(config);
    client = discordFactory();

    if (config.polls.enabled) {
      pollStore =
        dependencies.createPollStore?.(config.storage.databasePath) ??
        new SQLitePollStore(config.storage.databasePath);
    }

    const conversationService = new ConversationService({
      store: initializedStore,
      ai,
      rateLimiter: new RateLimiter(
        config.security.rateLimitRequests,
        config.security.rateLimitWindowMs,
      ),
      // One owner for event de-duplication: ConversationService.
      deduplicator: new EventDeduplicator(10 * 60 * 1_000, 10_000),
      persona,
      allowedChannelIds: config.security.allowedChannelIds,
      restrainedChannelIds: config.persona.restrainedChannelIds,
      maxInputChars: config.security.maxInputChars,
      maxHistoryMessages: config.storage.maxHistoryMessages,
      safetyIdentifierSecret:
        config.openai.apiKey.trim() === ''
          ? config.discord.token
          : config.openai.apiKey,
      logger,
      elapsedNow,
    });
    const cleanup = async (): Promise<void> => {
      try {
        await initializedStore.cleanup(
          new Date(
            Date.now() -
              config.storage.historyRetentionDays * 24 * 60 * 60 * 1_000,
          ),
        );
      } catch (error) {
        logger?.warn({ error }, 'Conversation retention cleanup failed.');
      }
    };
    await cleanup();

    const handlerState: {
      handlers: ReturnType<typeof createDiscordHandlers> | undefined;
    } = { handlers: undefined };
    client.on('messageCreate', (message) => {
      if (acceptingWork && handlerState.handlers !== undefined) {
        void handlerState.handlers
          .onMessageCreate(message as DiscordMessage)
          .catch((error: unknown) => {
            logger?.warn({ error }, 'Discord message event handling failed.');
          });
      }
      return undefined;
    });
    client.on('interactionCreate', (interaction) => {
      if (acceptingWork && handlerState.handlers !== undefined) {
        void handlerState.handlers
          .onInteractionCreate(interaction as DiscordInteraction)
          .catch((error: unknown) => {
            logger?.warn(
              { error },
              'Discord interaction event handling failed.',
            );
          });
      }
      return undefined;
    });

    await client.login(config.discord.token);
    const botUserId = client.user?.id.trim();
    if (botUserId === undefined || botUserId === '') {
      throw new Error('Discord client did not expose a bot user after login.');
    }
    let pollController: PollController | undefined;
    if (pollStore !== undefined) {
      const pollService = new DurablePollService({
        store: pollStore,
        voterSecret: config.polls.voterSecret,
      });
      pollController =
        dependencies.createPollController?.({
          service: pollService,
          client,
          botUserId,
          logger,
        }) ??
        createDefaultPollController({
          service: pollService,
          client,
          botUserId,
          logger,
        });
      pollScheduler =
        dependencies.createPollScheduler?.({
          service: pollService,
          store: pollStore,
          controller: pollController,
          retentionDays: config.polls.retentionDays,
          intervalMs: config.polls.expiryCheckSeconds * 1_000,
          timers,
          logger,
        }) ??
        new PollScheduler({
          service: pollService,
          store: pollStore,
          controller: pollController,
          retentionDays: config.polls.retentionDays,
          intervalMs: config.polls.expiryCheckSeconds * 1_000,
          timers,
          logger,
        });
    }

    handlerState.handlers = createDiscordHandlers({
      botUserId,
      allowedChannelIds: config.security.allowedChannelIds,
      conversationService,
      handleCommand: (interaction) =>
        handleCommand(interaction as CommandInteraction, {
          config,
          conversationService,
          store: initializedStore,
          faq,
          ...(pollController === undefined ? {} : { pollController }),
        }),
      ...(pollController === undefined ? {} : { pollController }),
    });

    pollScheduler?.start();

    cleanupTimer = timers.setInterval(() => {
      void cleanup();
    }, cleanupIntervalMs);
    registerSignal('SIGINT', shutdown);
    registerSignal('SIGTERM', shutdown);
    acceptingWork = true;
    logger.info(
      {
        elapsedMs: elapsedMilliseconds(startupStartedAt, elapsedNow()),
      },
      'Application startup completed.',
    );

    return { shutdown };
  } catch (error) {
    logger?.error(
      {
        elapsedMs: elapsedMilliseconds(startupStartedAt, elapsedNow()),
        ...projectOperationalError(error, 'startup'),
      },
      'Application startup failed.',
    );
    await shutdown();
    setExitCode(1);
    throw error;
  }
};

const elapsedMilliseconds = (startedAt: number, finishedAt: number): number => {
  const elapsed = finishedAt - startedAt;
  return Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : 0;
};

export const main = async (): Promise<void> => {
  await createApplication();
};

export const reportStartupFailure = (
  error: unknown,
  write: (message: string) => void = (message) => {
    process.stderr.write(`${message}\n`);
  },
): void => {
  const message =
    error instanceof Error &&
    (safeConfigurationError.test(error.message) ||
      error.message === safeFaqConfigurationErrorMessage)
      ? error.message
      : 'Application startup failed.';
  write(message);
};

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  void main().catch(reportStartupFailure);
}
