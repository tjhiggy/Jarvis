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
import {
  OpenAIResponsesService,
  type AIService,
  type OpenAIResponsesClient,
} from './openai/openai-service.js';
import { EventDeduplicator } from './security/event-deduplicator.js';
import { RateLimiter } from './security/rate-limiter.js';
import { ConversationService } from './services/conversation-service.js';
import type { ConversationStore } from './storage/conversation-store.js';
import { SQLiteConversationStore } from './storage/sqlite-conversation-store.js';
import { createLogger } from './utils/logger.js';

const cleanupIntervalMs = 24 * 60 * 60 * 1_000;
const safeConfigurationError =
  /^Invalid environment configuration: (?:[A-Z][A-Z0-9_]*|unknown)(?:, (?:[A-Z][A-Z0-9_]*|unknown))*$/;
let dotenvLoaded = false;

interface RuntimeDiscordClient {
  readonly user: Readonly<{ id: string }> | null;
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
  readonly createStore?: (
    databasePath: string,
    maxStoredMessages: number,
  ) => ConversationStore;
  readonly createAIService?: (config: AppConfig) => AIService;
  readonly createDiscordClient?: () => RuntimeDiscordClient;
  readonly createLogger?: (level: string) => Logger;
  readonly timers?: ApplicationTimers;
  readonly registerSignal?: (
    signal: NodeJS.Signals,
    handler: () => void | Promise<void>,
  ) => void;
  readonly setExitCode?: (code: number) => void;
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

const createDefaultAIService = (config: AppConfig): AIService =>
  new OpenAIResponsesService({
    client: new OpenAI({
      apiKey: config.openai.apiKey,
      timeout: config.openai.timeoutMs,
      maxRetries: config.openai.maxRetries,
    }) as unknown as OpenAIResponsesClient,
    model: config.openai.model,
    timeoutMs: config.openai.timeoutMs,
    maxRetries: config.openai.maxRetries,
    maxOutputTokens: 1_000,
  });

const createDefaultDiscordClient = (): RuntimeDiscordClient =>
  new Client({
    intents: discordGatewayIntents,
  }) as unknown as RuntimeDiscordClient;

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

  let logger: Logger | undefined;
  let store: ConversationStore | undefined;
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
    store = storeFactory(
      config.storage.databasePath,
      config.storage.maxStoredMessages,
    );
    const initializedStore = store;
    const ai = aiFactory(config);
    client = discordFactory();

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
      safetyIdentifierSecret: config.openai.apiKey,
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
    handlerState.handlers = createDiscordHandlers({
      botUserId,
      allowedChannelIds: config.security.allowedChannelIds,
      conversationService,
      handleCommand: (interaction) =>
        handleCommand(interaction as CommandInteraction, {
          config,
          conversationService,
          store: initializedStore,
        }),
    });

    cleanupTimer = timers.setInterval(() => {
      void cleanup();
    }, cleanupIntervalMs);
    registerSignal('SIGINT', shutdown);
    registerSignal('SIGTERM', shutdown);
    acceptingWork = true;

    return { shutdown };
  } catch (error) {
    await shutdown();
    setExitCode(1);
    throw error;
  }
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
    error instanceof Error && safeConfigurationError.test(error.message)
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
