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
  loadKnowledgeCatalog,
  type ApprovedKnowledgeCatalog,
} from './knowledge/approved-knowledge.js';
import { SQLiteKnowledgeApprovalStore } from './knowledge/knowledge-store.js';
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
import {
  DiscordReminderDeliveryGateway,
  type ReminderDeliveryChannel,
  type ReminderDeliveryGateway,
  type ReminderMessagePayload,
} from './reminders/reminder-delivery-gateway.js';
import {
  ReminderScheduler,
  type ReminderSchedulerDependencies,
} from './reminders/reminder-scheduler.js';
import { ReminderService } from './reminders/reminder-service.js';
import type { ReminderStore } from './reminders/reminder-store.js';
import { SQLiteReminderStore } from './reminders/sqlite-reminder-store.js';
import { createLogger, projectOperationalError } from './utils/logger.js';
import { loadRuntimeIdentity } from './config/runtime-identity.js';
import { HttpSleeperService } from './sleeper/sleeper-service.js';
import { randomUUID } from 'node:crypto';
import { Instrumentation } from './platform/instrumentation.js';
import {
  MemberStatisticsService,
  SQLiteMemberStatisticsStore,
} from './community/member-statistics.js';
import { ImageGenerationService } from './images/image-generation.js';
import { OpenAIImageProvider } from './openai/openai-image-service.js';
import {
  IntroductionService,
  type IntroductionGateway,
} from './engagement/introductions.js';
import type { EngagementRepository } from './engagement/storage.js';
import { SQLiteEngagementRepository } from './storage/engagement-sqlite.js';
import {
  SuggestionService,
  type SuggestionGateway,
} from './engagement/suggestions.js';
import {
  toDiscordEngagementCard,
  type DiscordEngagementCard,
} from './engagement/discord-ui.js';
import { EventService, type EventGateway } from './engagement/events.js';
import { EventScheduler } from './engagement/event-scheduler.js';
import {
  EngagementDeletionService,
  isUnknownDiscordMessage,
} from './engagement/deletion.js';
import { RecapScheduler, RecapService } from './engagement/recap.js';
import {
  buildTriviaResultsCard,
  TriviaExpiryScheduler,
  TriviaService,
} from './engagement/activity.js';
import {
  BirthdayScheduler,
  BirthdayService,
  birthdayStoreFromRepository,
  type BirthdayService as BirthdayServiceType,
} from './engagement/birthdays.js';
import {
  DurableProactiveScheduler,
  ProactiveEngagementService,
  type ProactiveScheduler,
} from './engagement/proactive.js';
import { DelegatedPostService } from './engagement/delegated-posts.js';
import {
  DailyRewardService,
  dailyRewardStoreFromRepository,
} from './engagement/daily-rewards.js';
import {
  ParticipationStreakService,
  participationStreakStoreFromRepository,
} from './engagement/participation-streaks.js';
import { FeatureFlagService } from './engagement/feature-flags.js';
import {
  MemberProfileService,
  memberProfileRepositoryFromEngagement,
} from './engagement/member-profiles.js';
import { RssStorage } from './notifications/rss-storage.js';
import { RssNotificationClient } from './notifications/rss-notifications.js';
import {
  loadProactiveCatalog,
  type ProactivePrompt,
} from './notifications/proactive-catalog.js';
import {
  renderRssDigest,
  RssScheduler,
  type RssDigest,
} from './notifications/rss-scheduler.js';
import {
  BroadcastPolicyService,
  type BroadcastCategory,
} from './notifications/broadcast-policy.js';
import type {
  BroadcastDeliveryHealth,
  BroadcastPolicy,
  BroadcastStore,
} from './notifications/broadcast-store.js';
import { SqliteBroadcastStore } from './notifications/sqlite-broadcast-store.js';
import { HttpGitHubReadOnlyService } from './github/github-service.js';
import {
  createCommandDeckRuntimeMutationApi,
  startAdminConsole as startAdminConsoleRuntime,
  type AdminConsole,
  type AdminConsoleBroadcastCategory,
} from './admin/admin-console.js';
import { resolveAdminPostChannels } from './admin/admin-post-channels.js';

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

type BroadcastPreferenceStore = BroadcastStore & { close(): Promise<void> };

interface IntroductionChannel {
  send(
    payload: Readonly<{
      content: string;
      allowedMentions: Readonly<{
        parse: readonly string[];
        repliedUser: false;
      }>;
    }>,
  ): Promise<Readonly<{ id: string }>>;
  messages: Readonly<{ delete(messageId: string): Promise<unknown> }>;
}

interface SuggestionChannel {
  send(payload: DiscordEngagementCard): Promise<Readonly<{ id: string }>>;
  messages: Readonly<{
    delete(messageId: string): Promise<unknown>;
    edit(messageId: string, payload: DiscordEngagementCard): Promise<unknown>;
  }>;
}
interface EventChannel {
  send(payload: unknown): Promise<Readonly<{ id: string }>>;
}
const createDefaultEventGateway = (
  client: RuntimeDiscordClient,
): EventGateway => ({
  async post(channelId, card) {
    const channel = await client.channels?.fetch(channelId);
    if (!isEventChannel(channel))
      throw new Error('Configured event channel is unavailable.');
    return channel.send(toDiscordEngagementCard(card));
  },
});
const isEventChannel = (value: unknown): value is EventChannel =>
  typeof value === 'object' &&
  value !== null &&
  'send' in value &&
  typeof value.send === 'function';

const createDefaultSuggestionGateway = (
  client: RuntimeDiscordClient,
): SuggestionGateway => ({
  async post(channelId, card) {
    const channel = await client.channels?.fetch(channelId);
    if (!isSuggestionChannel(channel))
      throw new Error('Configured suggestion channel is unavailable.');
    return channel.send(toDiscordEngagementCard(card));
  },
  async delete(channelId, messageId) {
    const channel = await client.channels?.fetch(channelId);
    if (!isSuggestionChannel(channel))
      throw new Error('Configured suggestion channel is unavailable.');
    await channel.messages.delete(messageId);
  },
  async edit(channelId, messageId, card) {
    const channel = await client.channels?.fetch(channelId);
    if (!isSuggestionChannel(channel))
      throw new Error('Configured suggestion channel is unavailable.');
    await channel.messages.edit(messageId, toDiscordEngagementCard(card));
  },
});

const isSuggestionChannel = (value: unknown): value is SuggestionChannel =>
  typeof value === 'object' &&
  value !== null &&
  'send' in value &&
  typeof value.send === 'function' &&
  'messages' in value &&
  typeof value.messages === 'object' &&
  value.messages !== null &&
  'delete' in value.messages &&
  typeof value.messages.delete === 'function';

const createDefaultIntroductionGateway = (
  client: RuntimeDiscordClient,
): IntroductionGateway => ({
  async post(channelId, content) {
    const channel = await client.channels?.fetch(channelId);
    if (!isIntroductionChannel(channel))
      throw new Error('Configured introduction channel is unavailable.');
    return channel.send({
      content,
      allowedMentions: { parse: [], repliedUser: false },
    });
  },
  async delete(channelId, messageId) {
    const channel = await client.channels?.fetch(channelId);
    if (!isIntroductionChannel(channel))
      throw new Error('Configured introduction channel is unavailable.');
    await channel.messages.delete(messageId);
  },
});

const isIntroductionChannel = (value: unknown): value is IntroductionChannel =>
  typeof value === 'object' &&
  value !== null &&
  'send' in value &&
  typeof value.send === 'function' &&
  'messages' in value &&
  typeof value.messages === 'object' &&
  value.messages !== null &&
  'delete' in value.messages &&
  typeof value.messages.delete === 'function';

export interface ApplicationTimers {
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface ApplicationDependencies {
  readonly loadEnvironment?: () => unknown;
  readonly loadConfig?: (env: NodeJS.ProcessEnv) => AppConfig;
  readonly loadPersona?: (path: string) => Promise<TrustedPersona>;
  readonly loadFaqCatalog?: (path: string) => Promise<FaqCatalog>;
  readonly loadKnowledgeCatalog?: (
    path: string,
  ) => Promise<ApprovedKnowledgeCatalog>;
  readonly loadProactiveCatalog?: (
    path: string,
  ) => Promise<readonly ProactivePrompt[]>;
  readonly createProactiveScheduler?: (
    service: ProactiveEngagementService,
  ) => ProactiveScheduler;
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
  readonly createReminderStore?: (databasePath: string) => ReminderStore;
  readonly createBroadcastStore?: (
    databasePath: string,
  ) => BroadcastPreferenceStore;
  readonly createEngagementRepository?: (
    databasePath: string,
  ) => EngagementRepository;
  readonly createReminderGateway?: (dependencies: {
    readonly client: RuntimeDiscordClient;
    readonly allowedChannelIds: ReadonlySet<string>;
  }) => ReminderDeliveryGateway;
  readonly createReminderScheduler?: (
    dependencies: ReminderSchedulerDependencies,
  ) => ReminderScheduler;
  readonly createAIService?: (config: AppConfig) => AIService;
  readonly createDiscordClient?: () => RuntimeDiscordClient;
  readonly createLogger?: (level: string) => Logger;
  readonly startAdminConsole?: typeof startAdminConsoleRuntime;
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

const createDefaultReminderGateway = (dependencies: {
  readonly client: RuntimeDiscordClient;
  readonly allowedChannelIds: ReadonlySet<string>;
}): ReminderDeliveryGateway =>
  new DiscordReminderDeliveryGateway({
    allowedChannelIds: dependencies.allowedChannelIds,
    fetchChannel: async (channelId) =>
      toReminderDeliveryChannel(
        await dependencies.client.channels?.fetch(channelId),
      ),
  });

const toReminderDeliveryChannel = (
  value: unknown,
): ReminderDeliveryChannel | undefined => {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    !('guildId' in value) ||
    typeof value.guildId !== 'string' ||
    !('send' in value) ||
    typeof value.send !== 'function'
  ) {
    return undefined;
  }
  const parentId =
    'parentId' in value &&
    typeof value.parentId === 'string' &&
    value.parentId.trim() !== ''
      ? value.parentId
      : undefined;
  const send = value.send as (
    payload: ReminderMessagePayload,
  ) => Promise<unknown>;
  return {
    id: value.id,
    guildId: value.guildId,
    ...(parentId === undefined ? {} : { parentId }),
    send: (payload) => send.call(value, payload),
  };
};

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
  const knowledgeCatalogLoader =
    dependencies.loadKnowledgeCatalog ?? loadKnowledgeCatalog;
  const proactiveCatalogLoader =
    dependencies.loadProactiveCatalog ?? loadProactiveCatalog;
  const storeFactory =
    dependencies.createStore ??
    ((path, maxStoredMessages) =>
      new SQLiteConversationStore(path, maxStoredMessages));
  const aiFactory = dependencies.createAIService ?? createDefaultAIService;
  const discordFactory =
    dependencies.createDiscordClient ?? createDefaultDiscordClient;
  const loggerFactory = dependencies.createLogger ?? createLogger;
  const adminConsoleFactory =
    dependencies.startAdminConsole ?? startAdminConsoleRuntime;
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
  let reminderStore: ReminderStore | undefined;
  let reminderScheduler: ReminderScheduler | undefined;
  let broadcastStore: BroadcastPreferenceStore | undefined;
  let engagementRepository: EngagementRepository | undefined;
  let instrumentation: Instrumentation | undefined;
  let memberStatisticsStore: SQLiteMemberStatisticsStore | undefined;
  let memberStatistics: MemberStatisticsService | undefined;
  let knowledgeStore: SQLiteKnowledgeApprovalStore | undefined;
  let imageGeneration: ImageGenerationService | undefined;
  let rssStorage: RssStorage | undefined;
  let rssScheduler: RssScheduler | undefined;
  let delegatedPostService: DelegatedPostService | undefined;
  let eventScheduler: EventScheduler | undefined;
  let recapScheduler: RecapScheduler | undefined;
  let triviaService: TriviaService | undefined;
  let birthdayService: BirthdayServiceType | undefined;
  let birthdayScheduler: BirthdayScheduler | undefined;
  let proactiveScheduler: ProactiveScheduler | undefined;
  let proactiveService: ProactiveEngagementService | undefined;
  let memberProfileService: MemberProfileService | undefined;
  let dailyRewardService: DailyRewardService | undefined;
  let participationStreakService: ParticipationStreakService | undefined;
  let triviaScheduler: TriviaExpiryScheduler | undefined;
  let engagementDeletionService: EngagementDeletionService | undefined;
  let client: RuntimeDiscordClient | undefined;
  let adminConsole: AdminConsole | undefined;
  let cleanupTimer: unknown;
  let acceptingWork = false;
  let shutdownPromise: Promise<void> | undefined;
  const activeWork = new Set<Promise<unknown>>();
  const trackWork = <T>(work: Promise<T>): Promise<T> => {
    const tracked = work.finally(() => {
      activeWork.delete(tracked);
    });
    activeWork.add(tracked);
    return tracked;
  };
  const drainActiveWork = async (): Promise<void> => {
    while (activeWork.size > 0) await Promise.allSettled([...activeWork]);
  };

  const shutdown = (): Promise<void> => {
    acceptingWork = false;
    shutdownPromise ??= (async () => {
      if (adminConsole !== undefined) {
        await adminConsole.close();
        adminConsole = undefined;
      }
      if (cleanupTimer !== undefined) {
        timers.clearInterval(cleanupTimer);
        cleanupTimer = undefined;
      }

      if (reminderScheduler !== undefined) {
        try {
          await reminderScheduler.stop();
        } catch (error) {
          logger?.warn(
            projectOperationalError(error, 'reminder_scheduler_shutdown'),
            'Reminder scheduler stop failed during shutdown.',
          );
        }
      }
      if (eventScheduler !== undefined) {
        try {
          await eventScheduler.stop();
        } catch (error) {
          logger?.warn(
            projectOperationalError(error, 'event_scheduler_shutdown'),
            'Event scheduler stop failed during shutdown.',
          );
        }
      }
      if (recapScheduler !== undefined) {
        try {
          await recapScheduler.stop();
        } catch (error) {
          logger?.warn(
            projectOperationalError(error, 'recap_scheduler_shutdown'),
            'Recap scheduler stop failed during shutdown.',
          );
        }
      }
      if (triviaScheduler !== undefined) {
        try {
          await triviaScheduler.stop();
        } catch (error) {
          logger?.warn(
            projectOperationalError(error, 'trivia_scheduler_shutdown'),
            'Trivia scheduler stop failed during shutdown.',
          );
        }
      }
      if (birthdayScheduler !== undefined) {
        try {
          await birthdayScheduler.stop();
        } catch (error) {
          logger?.warn(
            projectOperationalError(error, 'birthday_scheduler_shutdown'),
            'Birthday scheduler stop failed during shutdown.',
          );
        }
      }
      if (proactiveScheduler !== undefined) {
        try {
          await proactiveScheduler.stop();
        } catch (error) {
          logger?.warn(
            projectOperationalError(error, 'proactive_scheduler_shutdown'),
            'Proactive scheduler stop failed during shutdown.',
          );
        }
      }

      if (pollScheduler !== undefined) {
        try {
          await pollScheduler.stop();
        } catch (error) {
          logger?.warn(
            projectOperationalError(error, 'poll_scheduler_shutdown'),
            'Poll scheduler stop failed during shutdown.',
          );
        }
      }

      await drainActiveWork();

      if (broadcastStore !== undefined) {
        try {
          await broadcastStore.close();
        } catch (error) {
          logger?.warn(
            projectOperationalError(error, 'broadcast_storage_shutdown'),
            'Notification preference storage close failed during shutdown.',
          );
        }
      }

      if (reminderStore !== undefined) {
        try {
          await reminderStore.closeConnection();
        } catch (error) {
          logger?.warn(
            projectOperationalError(error, 'reminder_storage_shutdown'),
            'Reminder storage close failed during shutdown.',
          );
        }
      }

      if (engagementRepository !== undefined) {
        try {
          await engagementRepository.closeConnection();
        } catch (error) {
          logger?.warn(
            projectOperationalError(error, 'engagement_storage_shutdown'),
            'Engagement storage close failed during shutdown.',
          );
        }
      }
      if (memberStatisticsStore !== undefined) {
        try {
          memberStatisticsStore.close();
        } catch (error) {
          logger?.warn(
            projectOperationalError(error, 'member_statistics_shutdown'),
            'Member statistics storage close failed during shutdown.',
          );
        }
        memberStatisticsStore = undefined;
      }
      if (knowledgeStore !== undefined) {
        try {
          knowledgeStore.close();
        } catch (error) {
          logger?.warn(
            projectOperationalError(error, 'knowledge_storage_shutdown'),
            'Approved knowledge storage close failed during shutdown.',
          );
        }
        knowledgeStore = undefined;
      }
      if (rssScheduler !== undefined) {
        try {
          await rssScheduler.stop();
        } catch (error) {
          logger?.warn(
            projectOperationalError(error, 'rss_scheduler_shutdown'),
            'RSS scheduler stop failed during shutdown.',
          );
        }
      }
      if (rssStorage !== undefined) {
        try {
          rssStorage.close();
        } catch (error) {
          logger?.warn(
            { error: projectOperationalError(error, 'rss_storage_close') },
            'RSS storage close failed during shutdown.',
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
    const runtimeIdentity = loadRuntimeIdentity(process.env);
    logger = loggerFactory(config.logging.level);
    const persona = await personaLoader(config.persona.promptPath);
    const faq = await faqCatalogLoader(config.faq.catalogPath);
    const proactiveCatalog =
      config.engagement.proactiveCatalogPath === ''
        ? []
        : await proactiveCatalogLoader(config.engagement.proactiveCatalogPath);
    let knowledge: ApprovedKnowledgeCatalog | undefined;
    const knowledgePath =
      process.env.KNOWLEDGE_CATALOG_PATH?.trim() || './config/knowledge.json';
    try {
      knowledge = await knowledgeCatalogLoader(knowledgePath);
    } catch {
      knowledge = undefined;
    }
    store = storeFactory(
      config.storage.databasePath,
      config.storage.maxStoredMessages,
    );
    const initializedStore = store;
    if (knowledge !== undefined)
      knowledgeStore = new SQLiteKnowledgeApprovalStore(
        config.storage.databasePath,
      );
    let featureFlags: FeatureFlagService | undefined;
    reminderStore =
      dependencies.createReminderStore?.(config.storage.databasePath) ??
      new SQLiteReminderStore(config.storage.databasePath);
    const initializedReminderStore = reminderStore;
    broadcastStore =
      dependencies.createBroadcastStore?.(config.storage.databasePath) ??
      new SqliteBroadcastStore(config.storage.databasePath);
    const initializedBroadcastStore = broadcastStore;
    const runBroadcastDelivery = async <T>(
      category: BroadcastCategory,
      delivery: () => Promise<T>,
    ): Promise<T> => {
      const startedAt = new Date();
      await engagementRepository?.recordDeliveryMetric?.({
        serverId: config.discord.guildId,
        category,
        name: 'delivery_attempted',
        occurredAt: startedAt.toISOString(),
      });
      try {
        const result = await delivery();
        await engagementRepository?.recordDeliveryMetric?.({
          serverId: config.discord.guildId,
          category,
          name: 'delivery_succeeded',
          occurredAt: new Date().toISOString(),
          durationMs: Math.max(0, Date.now() - startedAt.getTime()),
        });
        return result;
      } catch (error) {
        await engagementRepository?.recordDeliveryMetric?.({
          serverId: config.discord.guildId,
          category,
          name: 'delivery_failed',
          occurredAt: new Date().toISOString(),
          durationMs: Math.max(0, Date.now() - startedAt.getTime()),
        });
        await engagementRepository?.recordDeliveryMetric?.({
          serverId: config.discord.guildId,
          category,
          name: 'delivery_retried',
          occurredAt: new Date().toISOString(),
        });
        throw error;
      }
    };
    const scheduledBroadcastPolicy = new BroadcastPolicyService(
      initializedBroadcastStore,
      [...config.security.allowedChannelIds],
      async ({ serverId, category, occurredAt }) => {
        await engagementRepository?.recordDeliveryMetric?.({
          serverId,
          category,
          name: 'delivery_suppressed',
          occurredAt: occurredAt.toISOString(),
        });
      },
    );
    const ensureScheduledBroadcastPolicy = async (
      category: BroadcastCategory,
      channelId: string,
    ): Promise<void> => {
      if (channelId === '') return;
      if (
        (await initializedBroadcastStore.getPolicy(
          config.discord.guildId,
          category,
        )) !== undefined
      )
        return;
      await initializedBroadcastStore.setPolicy({
        serverId: config.discord.guildId,
        category,
        state: 'enabled',
        channelId,
        timezone: config.engagement.recapTimezone,
        minimumIntervalSeconds: 0,
        digestMode: false,
        updatedAt: new Date(),
      });
    };
    if (
      config.engagement.channels.rssId !== '' &&
      config.engagement.rssAllowedHosts.length > 0
    ) {
      rssStorage = new RssStorage(config.storage.databasePath);
    }
    memberStatisticsStore = new SQLiteMemberStatisticsStore(
      config.storage.databasePath,
    );
    memberStatistics = new MemberStatisticsService(memberStatisticsStore);
    if (config.engagement.enabled) {
      engagementRepository =
        dependencies.createEngagementRepository?.(
          config.storage.databasePath,
        ) ?? new SQLiteEngagementRepository(config.storage.databasePath);
      featureFlags = new FeatureFlagService(
        engagementRepository as Required<
          Pick<EngagementRepository, 'getFeatureFlags' | 'setFeatureFlag'>
        >,
      );
    }
    instrumentation = new Instrumentation(
      {
        record: async (event) => {
          if (event.serverId === 'direct-message') return;
          await engagementRepository?.recordAnalyticsEvent?.(event);
        },
      },
      memberStatistics,
    );
    const ai = aiFactory(config);
    if (config.imageGeneration.enabled) {
      imageGeneration = new ImageGenerationService(
        new OpenAIImageProvider(
          config.openai.apiKey,
          config.imageGeneration.model,
          config.imageGeneration.timeoutMs,
        ),
      );
    }
    client = discordFactory();
    if (rssStorage !== undefined && config.engagement.channels.rssId !== '') {
      const rssBroadcastStore = initializedBroadcastStore;
      const existingRssPolicy = await rssBroadcastStore.getPolicy(
        config.discord.guildId,
        'rss',
      );
      if (existingRssPolicy === undefined) {
        await rssBroadcastStore.setPolicy({
          serverId: config.discord.guildId,
          category: 'rss',
          state: 'enabled',
          channelId: config.engagement.channels.rssId,
          timezone: 'UTC',
          minimumIntervalSeconds: 0,
          digestMode: true,
          updatedAt: new Date(),
        });
      }
      rssScheduler = new RssScheduler(
        rssStorage,
        new RssNotificationClient(
          fetch,
          8_000,
          config.engagement.rssAllowedHosts,
        ),
        {
          publish: async (channelId, digest) => {
            const channels = client?.channels;
            if (channels === undefined)
              throw new Error('Discord channels are unavailable.');
            const channel = await channels.fetch(channelId);
            const sendable = channel as unknown as {
              send(payload: unknown): Promise<unknown>;
            };
            if (
              channel === undefined ||
              channel === null ||
              typeof sendable.send !== 'function'
            )
              throw new Error('Configured RSS channel is unavailable.');
            await runBroadcastDelivery('rss', () =>
              sendable.send({
                content: digest.content,
                allowedMentions: { parse: [], repliedUser: false },
              }),
            );
          },
        },
        config.discord.guildId,
        config.engagement.channels.rssId,
        new BroadcastPolicyService(
          rssBroadcastStore,
          [config.engagement.channels.rssId],
          async ({ serverId, category, occurredAt }) => {
            await engagementRepository?.recordDeliveryMetric?.({
              serverId,
              category,
              name: 'delivery_suppressed',
              occurredAt: occurredAt.toISOString(),
            });
          },
        ),
        rssBroadcastStore,
        () => new Date(),
        { warn: (fields, message) => logger?.warn(fields, message) },
      );
      rssScheduler.start();
    }

    if (config.polls.enabled) {
      pollStore =
        dependencies.createPollStore?.(config.storage.databasePath) ??
        new SQLitePollStore(config.storage.databasePath);
      await pollStore.recoverCreating();
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
      runtimeIdentity,
    });
    const reminderService = new ReminderService({
      store: initializedReminderStore,
      rateLimiter: new RateLimiter(
        config.security.rateLimitRequests,
        config.security.rateLimitWindowMs,
      ),
    });
    const introductionService =
      engagementRepository === undefined
        ? undefined
        : new IntroductionService({
            repository: engagementRepository,
            gateway: createDefaultIntroductionGateway(client),
            rateLimiter: new RateLimiter(
              config.security.rateLimitRequests,
              config.security.rateLimitWindowMs,
            ),
            createId: () => randomUUID(),
          });
    if (
      engagementRepository !== undefined &&
      supportsMemberProfiles(engagementRepository)
    ) {
      memberProfileService = new MemberProfileService({
        repository: memberProfileRepositoryFromEngagement(engagementRepository),
        introductionReader: {
          getSuggestedInterests: async (serverId, userId) =>
            (
              await engagementRepository!.findActiveIntroductionByOwner(
                serverId,
                userId,
              )
            )?.interests ?? null,
        },
        createId: () => randomUUID(),
        maxDraftsPerOwner: config.engagement.maxRecordsPerUser,
      });
    }
    birthdayService =
      engagementRepository !== undefined &&
      typeof engagementRepository.getBirthday === 'function'
        ? new BirthdayService(
            birthdayStoreFromRepository(engagementRepository as any),
          )
        : undefined;
    participationStreakService =
      engagementRepository !== undefined &&
      typeof engagementRepository.recordParticipationStreak === 'function' &&
      typeof engagementRepository.isEngagementOptedOut === 'function'
        ? new ParticipationStreakService(
            participationStreakStoreFromRepository(
              engagementRepository as Required<
                Pick<
                  EngagementRepository,
                  'recordParticipationStreak' | 'isEngagementOptedOut'
                >
              >,
            ),
          )
        : undefined;
    dailyRewardService =
      engagementRepository !== undefined &&
      typeof engagementRepository.claimDailyReward === 'function' &&
      typeof engagementRepository.isEngagementOptedOut === 'function'
        ? new DailyRewardService(
            dailyRewardStoreFromRepository(
              engagementRepository as Required<
                Pick<
                  EngagementRepository,
                  | 'claimDailyReward'
                  | 'isEngagementOptedOut'
                  | 'recordParticipationStreak'
                >
              >,
            ),
          )
        : undefined;
    if (
      engagementRepository !== undefined &&
      config.engagement.channels.activityId !== '' &&
      proactiveCatalog.length > 0
    ) {
      const proactiveChannelId = config.engagement.channels.activityId;
      const existingProactivePolicy = await initializedBroadcastStore.getPolicy(
        config.discord.guildId,
        'proactive',
      );
      if (existingProactivePolicy === undefined) {
        await initializedBroadcastStore.setPolicy({
          serverId: config.discord.guildId,
          category: 'proactive',
          state: 'enabled',
          channelId: proactiveChannelId,
          timezone: 'UTC',
          quietStartMinute: 23 * 60,
          quietEndMinute: 8 * 60,
          minimumIntervalSeconds: 6 * 60 * 60,
          digestMode: false,
          updatedAt: new Date(),
        });
      }
      proactiveService = new ProactiveEngagementService({
        store: {
          get: (guildId) => engagementRepository!.getProactiveState!(guildId),
          set: (guildId, state, at) =>
            engagementRepository!.setProactiveState!(guildId, state, at),
          recordPosted: (guildId, at) =>
            engagementRepository!.recordProactivePosted!(guildId, at),
        },
        gateway: {
          post: async (channelId, content) => {
            const channel = await client!.channels?.fetch(channelId);
            if (!isEventChannel(channel))
              throw new Error('Configured proactive channel is unavailable.');
            await runBroadcastDelivery('proactive', () =>
              channel.send({
                content,
                allowedMentions: { parse: [], repliedUser: false },
              }),
            );
          },
        },
        channelId: config.engagement.channels.activityId,
        guildId: config.discord.guildId,
        isGloballyPaused: (guildId) =>
          engagementRepository!.engagementPaused!(guildId),
        catalog: proactiveCatalog,
        policy: new BroadcastPolicyService(
          initializedBroadcastStore,
          [...config.security.allowedChannelIds],
          async ({ serverId, category, occurredAt }) => {
            await engagementRepository?.recordDeliveryMetric?.({
              serverId,
              category,
              name: 'delivery_suppressed',
              occurredAt: occurredAt.toISOString(),
            });
          },
        ),
        broadcastStore: initializedBroadcastStore,
        logger,
      });
    }
    const suggestionService =
      engagementRepository === undefined
        ? undefined
        : new SuggestionService({
            repository: engagementRepository,
            gateway: createDefaultSuggestionGateway(client),
            rateLimiter: new RateLimiter(
              config.security.rateLimitRequests,
              config.security.rateLimitWindowMs,
            ),
            createId: () => randomUUID(),
            adminRoleIds: config.engagement.adminRoleIds,
            maxDraftsPerOwner: config.engagement.maxRecordsPerUser,
            audit: (event) =>
              logger?.info(
                {
                  operation: event.operation,
                  action: event.action,
                  guildId: event.guildId,
                  suggestionId: event.suggestionId,
                  actorUserId: event.actorUserId,
                },
                'Suggestion moderation recorded.',
              ),
            onPersistenceFailure: (event) =>
              logger?.error(
                { guildId: event.guildId, suggestionId: event.suggestionId },
                'Suggestion persistence requires cleanup.',
              ),
            onCardRefreshFailure: (event) =>
              logger?.warn(
                {
                  guildId: event.guildId,
                  suggestionId: event.suggestionId,
                  messageId: event.messageId,
                },
                'Suggestion moderation card refresh failed; database state retained.',
              ),
          });
    delegatedPostService = new DelegatedPostService({
      createId: () => randomUUID(),
      adminRoleIds: config.engagement.adminRoleIds,
      gateway: {
        post: async (channelId, card) => {
          const channel = await client!.channels?.fetch(channelId);
          if (!isEventChannel(channel))
            throw new Error('Configured test channel is unavailable.');
          return channel.send(toDiscordEngagementCard(card));
        },
      },
    });
    const eventService =
      engagementRepository === undefined
        ? undefined
        : new EventService({
            repository: engagementRepository as any,
            createId: () => randomUUID(),
            adminRoleIds: config.engagement.adminRoleIds,
            gateway: createDefaultEventGateway(client),
          });
    const recapService =
      engagementRepository === undefined
        ? undefined
        : new RecapService({
            repository: engagementRepository as Required<
              Pick<EngagementRepository, 'recapSource'>
            >,
          });
    triviaService =
      engagementRepository === undefined
        ? undefined
        : new TriviaService({
            repository: engagementRepository as Required<
              Pick<
                EngagementRepository,
                | 'getOptOut'
                | 'createTriviaRound'
                | 'getTriviaRound'
                | 'findOpenTriviaRound'
                | 'recordTriviaAnswer'
                | 'getTriviaResults'
                | 'expireTriviaRounds'
                | 'claimTriviaResultCards'
                | 'completeTriviaResultCard'
                | 'releaseTriviaResultCard'
                | 'optOutTriviaParticipant'
              >
            >,
            createId: () => randomUUID(),
            maxParticipants: config.engagement.maxParticipants,
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
      if (engagementRepository !== undefined) {
        const cutoff = new Date(
          Date.now() - config.engagement.retentionDays * 24 * 60 * 60 * 1_000,
        );
        try {
          await engagementDeletionService?.cleanupPending(100);
          await introductionService?.cleanup(cutoff, 100);
          suggestionService?.cleanupDrafts();
          await suggestionService?.cleanupPostedCards(cutoff, 100);
          await engagementRepository.cleanup(cutoff, 100);
        } catch (error) {
          logger?.warn({ error }, 'Engagement retention cleanup failed.');
        }
      }
      try {
        await memberStatistics?.cleanup();
      } catch (error) {
        logger?.warn(
          projectOperationalError(error, 'member_statistics_cleanup'),
          'Member statistics retention cleanup failed.',
        );
      }
    };
    const handlerState: {
      handlers: ReturnType<typeof createDiscordHandlers> | undefined;
    } = { handlers: undefined };
    client.on('messageCreate', (message) => {
      if (acceptingWork && handlerState.handlers !== undefined) {
        void trackWork(
          handlerState.handlers
            .onMessageCreate(message as DiscordMessage)
            .catch((error: unknown) => {
              logger?.warn({ error }, 'Discord message event handling failed.');
            }),
        );
      }
      return undefined;
    });
    client.on('interactionCreate', (interaction) => {
      if (acceptingWork && handlerState.handlers !== undefined) {
        void trackWork(
          handlerState.handlers
            .onInteractionCreate(interaction as DiscordInteraction)
            .catch((error: unknown) => {
              logger?.warn(
                { error },
                'Discord interaction event handling failed.',
              );
            }),
        );
      }
      return undefined;
    });

    await client.login(config.discord.token);
    const botUserId = client.user?.id.trim();
    if (botUserId === undefined || botUserId === '') {
      throw new Error('Discord client did not expose a bot user after login.');
    }
    if (engagementRepository !== undefined)
      engagementDeletionService = new EngagementDeletionService({
        repository: engagementRepository as Required<
          Pick<
            EngagementRepository,
            | 'deleteOwnerData'
            | 'listPendingCardDeletions'
            | 'listPendingCardDeletionsForOwner'
            | 'completeCardDeletion'
          >
        > &
          EngagementRepository,
        gateway: {
          delete: async (channelId, messageId) => {
            const channel = await client?.channels?.fetch(channelId);
            if (!isIntroductionChannel(channel))
              throw new Error('Configured engagement channel is unavailable.');
            try {
              await channel.messages.delete(messageId);
            } catch (error) {
              if (!isUnknownDiscordMessage(error)) throw error;
            }
          },
        },
      });
    if (config.adminConsole?.enabled) {
      const adminPostChannels = await resolveAdminPostChannels(
        [...config.security.allowedChannelIds],
        async (channelId) => {
          const channel = await client?.channels?.fetch(channelId);
          if (!isEventChannel(channel)) return undefined;
          return typeof channel === 'object' &&
            channel !== null &&
            'name' in channel &&
            typeof channel.name === 'string' &&
            channel.name.trim() !== ''
            ? channel.name.trim()
            : undefined;
        },
      );
      adminConsole = await adminConsoleFactory({
        port: config.adminConsole.port,
        host: config.adminConsole.host,
        readApi:
          config.adminConsole.readApi.token === ''
            ? undefined
            : {
                ...config.adminConsole.readApi,
                audit: (event) => {
                  logger?.info(
                    {
                      operation: 'command_deck_read',
                      outcome: event.outcome,
                      requestId: event.requestId,
                      originClass: event.originClass,
                      observedAt: event.observedAt,
                    },
                    'Command Deck read request recorded.',
                  );
                },
              },
        mutationApi:
          config.adminConsole.readApi.token === '' ||
          config.adminConsole.token === ''
            ? undefined
            : createCommandDeckRuntimeMutationApi({
                authorization: {
                  ...config.adminConsole.readApi,
                  token: config.adminConsole.token,
                  audit: (event) => {
                    logger?.info(
                      {
                        operation: 'command_deck_mutation_authorization',
                        outcome: event.outcome,
                        requestId: event.requestId,
                        originClass: event.originClass,
                        observedAt: event.observedAt,
                      },
                      'Command Deck mutation request recorded.',
                    );
                  },
                },
                databasePath: config.storage.databasePath,
                guildId: config.discord.guildId,
                broadcastStore: initializedBroadcastStore,
                featureFlags,
                rssStorage,
                configuredBroadcasts: configuredBroadcasts(config).map(
                  ({ category, channelId }) => ({ category, channelId }),
                ),
                allowedChannelIds: config.security.allowedChannelIds,
                allowedRssHosts: config.engagement.rssAllowedHosts,
                rssChannelId: config.engagement.channels.rssId,
                audit: (event) => {
                  logger?.info(
                    {
                      operation: `command_deck_config_${event.event}`,
                      actionType: event.actionType,
                      previewId: event.previewId,
                      receiptId: event.receiptId,
                    },
                    'Command Deck configuration mutation recorded.',
                  );
                },
              }),
        postControl:
          config.adminConsole.token === '' || delegatedPostService === undefined
            ? undefined
            : {
                token: config.adminConsole.token,
                channels: adminPostChannels,
                preview: async ({ channelId, content }) => {
                  const draft = delegatedPostService!.preview({
                    guildId: config.discord.guildId,
                    ownerUserId: botUserId,
                    ownerName: 'Command Deck',
                    ownerRoleIds: config.engagement.adminRoleIds,
                    channelId,
                    content,
                  });
                  const channel = adminPostChannels.find(
                    (candidate) => candidate.id === channelId,
                  );
                  return {
                    draftId: draft.id,
                    destination: `#${channel?.label ?? 'approved-channel'}`,
                    title: 'MuthaShip transmission',
                    description: draft.content,
                  };
                },
                confirm: async (draftId) => {
                  const message = await delegatedPostService!.confirm({
                    guildId: config.discord.guildId,
                    ownerUserId: botUserId,
                    draftId,
                  });
                  return { messageId: message.id };
                },
                cancel: async (draftId) =>
                  delegatedPostService!.cancel({
                    guildId: config.discord.guildId,
                    ownerUserId: botUserId,
                    draftId,
                  }),
                audit: async ({ operation, channelId, outcome }) => {
                  logger?.info(
                    {
                      operation: `command_deck_post_${operation}`,
                      channelId,
                      outcome,
                    },
                    'Command Deck broadcast action recorded.',
                  );
                },
              },
        broadcastControl:
          config.adminConsole.token === ''
            ? undefined
            : {
                token: config.adminConsole.token,
                allowedCategories: configuredBroadcasts(config)
                  .filter(({ channelId }) =>
                    config.security.allowedChannelIds.has(channelId),
                  )
                  .map(({ category }) => category),
                setState: async (category, state) => {
                  const policy = await initializedBroadcastStore.getPolicy(
                    config.discord.guildId,
                    category,
                  );
                  if (
                    policy === undefined ||
                    !config.security.allowedChannelIds.has(policy.channelId)
                  ) {
                    throw new Error('Broadcast category is not allowlisted.');
                  }
                  await initializedBroadcastStore.setPolicy({
                    ...policy,
                    state,
                    updatedAt: new Date(),
                  });
                },
                audit: async ({ category, operation }) => {
                  logger?.info(
                    { operation: `broadcast_${operation}`, category },
                    'Shipboard broadcast state changed from the Command Deck.',
                  );
                },
              },
        rssControl:
          rssStorage === undefined || config.adminConsole.token === ''
            ? undefined
            : {
                token: config.adminConsole.token,
                setPaused: async (paused: boolean) => {
                  rssStorage?.setPaused(config.discord.guildId, paused);
                },
                preview: async (url: string) =>
                  new RssNotificationClient(
                    fetch,
                    8_000,
                    config.engagement.rssAllowedHosts,
                  ).fetch(url, 5),
              },
        snapshot: async () => {
          const snapshotNow = new Date();
          const rows =
            engagementRepository?.analyticsSummary === undefined
              ? []
              : await engagementRepository.analyticsSummary(
                  config.discord.guildId,
                  new Date(Date.now() - 7 * 86_400_000),
                );
          const deliveryRows7 =
            engagementRepository?.deliveryMetricsSummary === undefined
              ? []
              : await engagementRepository.deliveryMetricsSummary(
                  config.discord.guildId,
                  new Date(snapshotNow.getTime() - 7 * 86_400_000),
                );
          const deliveryRows30 =
            engagementRepository?.deliveryMetricsSummary === undefined
              ? []
              : await engagementRepository.deliveryMetricsSummary(
                  config.discord.guildId,
                  new Date(snapshotNow.getTime() - 30 * 86_400_000),
                );
          const broadcasts = await Promise.all(
            configuredBroadcasts(config).map(async (configured) => {
              const [policy, delivery, lastSuccess] = await Promise.all([
                initializedBroadcastStore.getPolicy(
                  config.discord.guildId,
                  configured.category,
                ),
                initializedBroadcastStore.latestDeliveryHealth(
                  config.discord.guildId,
                  configured.category,
                ),
                initializedBroadcastStore.getLatestCompletedAt(
                  config.discord.guildId,
                  configured.category,
                ),
              ]);
              const runtimeAvailable = broadcastRuntimeAvailable(
                configured.category,
                {
                  rss: rssScheduler !== undefined,
                  proactive: proactiveScheduler !== undefined,
                  recap: recapScheduler?.healthy === true,
                  eventReminder: eventScheduler?.healthy === true,
                  birthday: birthdayScheduler?.healthy === true,
                  trivia: triviaScheduler?.healthy === true,
                },
              );
              return broadcastCard(
                configured,
                policy,
                delivery,
                lastSuccess,
                runtimeAvailable,
                snapshotNow,
              );
            }),
          );
          const features = ['introductions', 'suggestions', 'events', 'trivia'];
          const approvedSources =
            knowledge === undefined
              ? 0
              : knowledgeStore === undefined
                ? knowledge.entries.filter((entry) => entry.approved).length
                : (
                    await knowledgeStore.listForAdmin(
                      config.discord.guildId,
                      knowledge,
                    )
                  ).filter((entry) => entry.active).length;
          return {
            platform: {
              version: config.runtimeIdentity?.version ?? 'unknown',
              environment: config.runtimeIdentity?.environment ?? 'unknown',
            },
            database:
              engagementRepository === undefined ? 'unavailable' : 'healthy',
            engagement: { enabled: config.engagement.enabled, features },
            providers: {
              ai: config.ai.provider,
              openAiConfigured: config.openai.apiKey !== '',
              ollamaConfigured: config.ollama.baseUrl !== '',
              webSearchConfigured: config.webSearch.apiKey !== '',
            },
            integrations: {
              rss: rssIntegrationHealth(
                config.engagement.channels.rssId,
                rssScheduler !== undefined,
              ),
              sleeper: config.sleeper?.leagueId !== '',
              github: config.github !== undefined,
            },
            metrics:
              engagementRepository?.analyticsSummary === undefined
                ? null
                : {
                    events: rows.reduce((sum, row) => sum + row.count, 0),
                    failures: rows
                      .filter((row) => row.eventName === 'command_failed')
                      .reduce((sum, row) => sum + row.count, 0),
                  },
            intelligence: {
              approvedSources,
              retainedSearch: store === undefined ? 'unavailable' : 'ready',
              optedInMembers:
                (await memberStatistics?.optedInCount(
                  config.discord.guildId,
                )) ?? 0,
              imageGeneration: config.imageGeneration.enabled
                ? imageGeneration === undefined
                  ? 'unavailable'
                  : 'ready'
                : 'disabled',
              localModel: config.ollama.model,
            },
            rss:
              rssStorage === undefined
                ? undefined
                : {
                    paused: rssStorage.isPaused(config.discord.guildId),
                    feeds: rssStorage
                      .listFeeds(config.discord.guildId)
                      .map(({ label, url }) => ({ label, url })),
                  },
            broadcasts: {
              categories: broadcasts,
              last7Days: deliveryRows7.map((row) => ({
                category: row.category,
                eventName: row.eventName,
                count: row.count,
              })),
              last30Days: deliveryRows30.map((row) => ({
                category: row.category,
                eventName: row.eventName,
                count: row.count,
              })),
            },
          };
        },
      });
      logger?.info(
        { port: config.adminConsole.port, host: config.adminConsole.host },
        'Local Admin Console started.',
      );
    }
    await triviaService?.recover();
    await cleanup();
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

    const reminderGateway =
      dependencies.createReminderGateway?.({
        client,
        allowedChannelIds: config.security.allowedChannelIds,
      }) ??
      createDefaultReminderGateway({
        client,
        allowedChannelIds: config.security.allowedChannelIds,
      });
    reminderScheduler =
      dependencies.createReminderScheduler?.({
        store: initializedReminderStore,
        gateway: reminderGateway,
        timers,
        logger,
      }) ??
      new ReminderScheduler({
        store: initializedReminderStore,
        gateway: reminderGateway,
        timers,
        logger,
      });
    const initializedReminderScheduler = reminderScheduler;
    handlerState.handlers = createDiscordHandlers({
      botUserId,
      allowedChannelIds: config.security.allowedChannelIds,
      conversationService,
      handleCommand: (interaction) =>
        handleCommand(interaction as CommandInteraction, {
          config,
          ...(instrumentation === undefined ? {} : { instrumentation }),
          ...(config.github
            ? {
                github: {
                  service: new HttpGitHubReadOnlyService(
                    config.github.owner,
                    config.github.repo,
                    config.github.token,
                    config.github.timeoutMs,
                  ),
                },
              }
            : {}),
          ...(rssStorage === undefined ? {} : { rssStorage }),
          broadcastStore: initializedBroadcastStore,
          conversationService,
          conversationHistory: initializedStore,
          store: initializedStore,
          reminderService,
          reminderHealth: {
            store: initializedReminderStore,
            scheduler: initializedReminderScheduler,
          },
          faq,
          ...(knowledge === undefined ? {} : { knowledge }),
          ...(knowledgeStore === undefined ? {} : { knowledgeStore }),
          ...(memberStatistics === undefined ? {} : { memberStatistics }),
          ...(imageGeneration === undefined ? {} : { imageGeneration }),
          ...(introductionService === undefined ? {} : { introductionService }),
          ...(suggestionService === undefined ? {} : { suggestionService }),
          ...(eventService === undefined ? {} : { eventService }),
          ...(recapService === undefined
            ? {}
            : {
                recapService,
                recapRepository: engagementRepository as Required<
                  Pick<EngagementRepository, 'setRecapEnabled'>
                >,
              }),
          ...(triviaService === undefined ? {} : { triviaService }),
          ...(proactiveService === undefined ? {} : { proactiveService }),
          ...(featureFlags === undefined ? {} : { featureFlags }),
          ...(memberProfileService === undefined
            ? {}
            : { memberProfileService }),
          ...(engagementRepository === undefined
            ? {}
            : {
                engagementHealth: {
                  repository: {
                    engagementPaused:
                      engagementRepository.engagementPaused!.bind(
                        engagementRepository,
                      ),
                    setEngagementPaused:
                      engagementRepository.setEngagementPaused!.bind(
                        engagementRepository,
                      ),
                    healthCheck:
                      engagementRepository.healthCheck.bind(
                        engagementRepository,
                      ),
                    statusCounts:
                      engagementRepository.statusCounts!.bind(
                        engagementRepository,
                      ),
                    deleteOwnerData:
                      engagementDeletionService!.deleteOwnerData.bind(
                        engagementDeletionService,
                      ),
                    analyticsSummary:
                      engagementRepository.analyticsSummary!.bind(
                        engagementRepository,
                      ),
                  },
                  schedulers: {
                    get events() {
                      return eventScheduler;
                    },
                    get recaps() {
                      return recapScheduler;
                    },
                    get trivia() {
                      return triviaScheduler;
                    },
                  },
                },
              }),
          ...(config.sleeper?.leagueId === undefined ||
          config.sleeper.leagueId === ''
            ? {}
            : {
                sleeper: {
                  leagueId: config.sleeper.leagueId,
                  service: new HttpSleeperService(),
                },
              }),
          ...(pollController === undefined ? {} : { pollController }),
          ...(pollStore === undefined || pollScheduler === undefined
            ? {}
            : {
                pollHealth: {
                  store: pollStore,
                  scheduler: pollScheduler,
                },
              }),
        }),
      ...(pollController === undefined ? {} : { pollController }),
      ...(introductionService === undefined ? {} : { introductionService }),
      ...(memberProfileService === undefined ? {} : { memberProfileService }),
      ...(memberProfileService === undefined || featureFlags === undefined
        ? {}
        : {
            isMemberProfileEnabled: (serverId: string) =>
              featureFlags.isEnabled(serverId, 'profiles'),
          }),
      ...(suggestionService === undefined
        ? {}
        : {
            suggestionService,
            engagementAdminRoleIds: config.engagement.adminRoleIds,
            suggestionChannelId: config.engagement.channels.suggestionId,
          }),
      ...(delegatedPostService === undefined ? {} : { delegatedPostService }),
      ...(eventService === undefined
        ? {}
        : { eventService, eventChannelId: config.engagement.channels.eventId }),
      ...(triviaService === undefined
        ? {}
        : {
            triviaService,
            activityChannelId: config.engagement.channels.activityId,
          }),
      ...(birthdayService === undefined ? {} : { birthdayService }),
      ...(dailyRewardService === undefined ? {} : { dailyRewardService }),
      ...(participationStreakService === undefined
        ? {}
        : { participationStreakService }),
      ...(config.engagement.roleMenuChoices === undefined
        ? {}
        : { roleMenuChoices: config.engagement.roleMenuChoices }),
      onPreviewActionError: (event) =>
        logger?.warn(
          {
            operation: 'engagement-preview-action',
            kind: event.kind,
            guildId: event.guildId,
            draftId: event.draftId,
            code: event.code,
          },
          'Engagement preview action failed.',
        ),
    });

    const schedulerClient = client;
    if (schedulerClient === undefined)
      throw new Error('Discord client is unavailable for event scheduling.');
    if (eventService !== undefined)
      await ensureScheduledBroadcastPolicy(
        'event_reminder',
        config.engagement.channels.eventId,
      );
    if (eventService !== undefined)
      eventScheduler = new EventScheduler({
        repository: engagementRepository as any,
        policy: scheduledBroadcastPolicy,
        broadcastStore: initializedBroadcastStore,
        logger: { warn: (fields, message) => logger?.warn(fields, message) },
        gateway: {
          deliver: async (reminder) => {
            const channel = await schedulerClient.channels?.fetch(
              reminder.channelId,
            );
            if (!isEventChannel(channel))
              throw new Error('Configured event channel is unavailable.');
            await runBroadcastDelivery('event_reminder', () =>
              channel.send({
                content: `<@${reminder.userId}> reminder: ${reminder.title} is due now.`,
                allowedMentions: {
                  parse: [],
                  repliedUser: false,
                },
              }),
            );
          },
        },
      });
    if (
      recapService !== undefined &&
      config.engagement.channels.recapId !== '' &&
      config.engagement.recapSchedule !== ''
    )
      await ensureScheduledBroadcastPolicy(
        'recap',
        config.engagement.channels.recapId,
      );
    if (
      recapService !== undefined &&
      config.engagement.channels.recapId !== '' &&
      config.engagement.recapSchedule !== ''
    )
      recapScheduler = new RecapScheduler({
        guildId: config.discord.guildId,
        channelId: config.engagement.channels.recapId,
        schedule: config.engagement.recapSchedule,
        timezone: config.engagement.recapTimezone,
        repository: engagementRepository as Required<
          Pick<
            EngagementRepository,
            | 'recapEnabled'
            | 'claimRecapRun'
            | 'completeRecapRun'
            | 'releaseRecapRun'
          >
        >,
        logger: { warn: (fields, message) => logger?.warn(fields, message) },
        policy: scheduledBroadcastPolicy,
        broadcastStore: initializedBroadcastStore,
        service: recapService,
        gateway: {
          post: async (channelId, content) => {
            const channel = await schedulerClient.channels?.fetch(channelId);
            if (!isEventChannel(channel))
              throw new Error('Configured recap channel is unavailable.');
            await runBroadcastDelivery('recap', () =>
              channel.send({
                content,
                allowedMentions: { parse: [], repliedUser: false },
              }),
            );
          },
        },
      });

    if (
      triviaService !== undefined &&
      config.engagement.channels.activityId !== ''
    )
      await ensureScheduledBroadcastPolicy(
        'trivia',
        config.engagement.channels.activityId,
      );
    if (triviaService !== undefined)
      triviaScheduler = new TriviaExpiryScheduler({
        service: triviaService,
        policy: scheduledBroadcastPolicy,
        isPaused: (guildId) =>
          engagementRepository?.engagementPaused?.(guildId) ??
          Promise.resolve(true),
        gateway: {
          post: async (round, results) => {
            const channel = await schedulerClient.channels?.fetch(
              round.channelId,
            );
            if (!isEventChannel(channel))
              throw new Error('Configured activity channel is unavailable.');
            await runBroadcastDelivery('trivia', () =>
              channel.send(buildTriviaResultsCard(results)),
            );
          },
        },
        logger: {
          warn: (fields, message) => logger?.warn(fields, message),
        },
      });

    if (
      birthdayService !== undefined &&
      config.engagement.channels.birthdayId !== ''
    ) {
      await ensureScheduledBroadcastPolicy(
        'birthday',
        config.engagement.channels.birthdayId,
      );
      birthdayScheduler = new BirthdayScheduler({
        store: birthdayStoreFromRepository(engagementRepository as any),
        guildId: config.discord.guildId,
        channelId: config.engagement.channels.birthdayId,
        timezone: config.engagement.recapTimezone,
        policy: scheduledBroadcastPolicy,
        broadcastStore: initializedBroadcastStore,
        isGloballyPaused: (guildId) =>
          engagementRepository!.engagementPaused!(guildId),
        gateway: {
          announce: async ({ channelId, content, allowedMentions }) => {
            const channel = await schedulerClient.channels?.fetch(channelId);
            if (!isEventChannel(channel))
              throw new Error('Configured birthday channel is unavailable.');
            await runBroadcastDelivery('birthday', () =>
              channel.send({ content, allowedMentions }),
            );
          },
        },
      });
    }

    pollScheduler?.start();
    reminderScheduler.start();
    eventScheduler?.start();
    recapScheduler?.start();
    triviaScheduler?.start();
    birthdayScheduler?.start();
    if (proactiveService !== undefined) {
      proactiveScheduler =
        dependencies.createProactiveScheduler?.(proactiveService) ??
        new DurableProactiveScheduler(proactiveService, 60_000, logger);
      proactiveScheduler.start();
    }

    cleanupTimer = timers.setInterval(() => {
      void trackWork(cleanup());
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

export const formatRssDigest = (digest: RssDigest): string => {
  return renderRssDigest(digest).content;
};

const configuredBroadcasts = (config: AppConfig) =>
  [
    {
      category: 'rss' as const,
      channelId: config.engagement.channels.rssId,
      label: 'RSS',
      destination: '#jarvis-updates',
    },
    {
      category: 'proactive' as const,
      channelId: config.engagement.channels.activityId,
      label: 'Crew pulse',
      destination: '#crew-activity',
    },
    {
      category: 'recap' as const,
      channelId: config.engagement.channels.recapId,
      label: 'Crew recap',
      destination: '#crew-recaps',
    },
    {
      category: 'event_reminder' as const,
      channelId: config.engagement.channels.eventId,
      label: 'Event reminders',
      destination: '#crew-events',
    },
    {
      category: 'birthday' as const,
      channelId: config.engagement.channels.birthdayId,
      label: 'Birthday watch',
      destination: '#crew-birthdays',
    },
    {
      category: 'trivia' as const,
      channelId: config.engagement.channels.activityId,
      label: 'Trivia results',
      destination: '#crew-activity',
    },
  ].filter(({ channelId }) => channelId !== '');

const broadcastRuntimeAvailable = (
  category: BroadcastCategory,
  runtime: Readonly<{
    rss: boolean;
    proactive: boolean;
    recap: boolean;
    eventReminder: boolean;
    birthday: boolean;
    trivia: boolean;
  }>,
): boolean =>
  ({
    rss: runtime.rss,
    proactive: runtime.proactive,
    recap: runtime.recap,
    event_reminder: runtime.eventReminder,
    birthday: runtime.birthday,
    trivia: runtime.trivia,
  })[category];

const broadcastCard = (
  configured: ReturnType<typeof configuredBroadcasts>[number],
  policy: BroadcastPolicy | undefined,
  delivery: BroadcastDeliveryHealth | undefined,
  lastSuccess: Date | undefined,
  runtimeAvailable: boolean,
  now: Date,
): AdminConsoleBroadcastCategory => {
  const nextEligibleAt =
    policy === undefined
      ? undefined
      : nextBroadcastEligibleAt(policy, lastSuccess, now).toISOString();
  const health =
    policy === undefined
      ? 'unavailable'
      : runtimeAvailable
        ? 'ready'
        : 'degraded';
  return {
    category: configured.category,
    label: configured.label,
    state: policy?.state ?? 'disabled',
    destination: configured.destination,
    quietHours:
      policy === undefined ? 'not configured' : formatQuietHours(policy),
    cadence:
      policy === undefined
        ? 'not configured'
        : formatCadence(policy.minimumIntervalSeconds),
    ...(nextEligibleAt === undefined ? {} : { nextEligibleAt }),
    ...(delivery?.claimedAt === undefined
      ? {}
      : { lastAttemptAt: delivery.claimedAt.toISOString() }),
    ...(lastSuccess === undefined
      ? {}
      : { lastSuccessAt: lastSuccess.toISOString() }),
    ...(delivery?.errorCategory === undefined
      ? {}
      : { errorCategory: delivery.errorCategory }),
    health,
    ...(health === 'ready'
      ? {}
      : {
          recovery:
            policy === undefined
              ? 'Broadcast policy is not available for this MuthaShip.'
              : 'Scheduler or provider is unavailable on this MuthaShip.',
        }),
  };
};

export const nextBroadcastEligibleAt = (
  policy: BroadcastPolicy,
  lastSuccess: Date | undefined,
  now: Date,
): Date => {
  let candidate = new Date(
    Math.max(
      now.getTime(),
      (lastSuccess?.getTime() ?? now.getTime()) +
        policy.minimumIntervalSeconds * 1_000,
    ),
  );
  if (
    policy.quietStartMinute === undefined ||
    policy.quietEndMinute === undefined ||
    policy.quietStartMinute === policy.quietEndMinute
  ) {
    return candidate;
  }
  for (let minute = 0; minute <= 24 * 60; minute += 1) {
    if (!isBroadcastQuietHour(policy, candidate)) return candidate;
    candidate = new Date(
      Math.floor(candidate.getTime() / 60_000) * 60_000 + 60_000,
    );
  }
  return candidate;
};

const isBroadcastQuietHour = (policy: BroadcastPolicy, now: Date): boolean => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: policy.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  const currentMinute = hour * 60 + minute;
  const start = policy.quietStartMinute;
  const end = policy.quietEndMinute;
  if (start === undefined || end === undefined) return false;
  return start < end
    ? currentMinute >= start && currentMinute < end
    : currentMinute >= start || currentMinute < end;
};

const formatQuietHours = (policy: BroadcastPolicy): string => {
  if (
    policy.quietStartMinute === undefined ||
    policy.quietEndMinute === undefined
  ) {
    return 'none';
  }
  const display = (minute: number): string =>
    `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  return `${display(policy.quietStartMinute)} to ${display(policy.quietEndMinute)} ${policy.timezone}`;
};

const formatCadence = (seconds: number): string => {
  if (seconds === 0) return 'no minimum interval';
  if (seconds % 3_600 === 0)
    return `${seconds / 3_600} hour${seconds === 3_600 ? '' : 's'}`;
  if (seconds % 60 === 0) return `${seconds / 60} minutes`;
  return `${seconds} seconds`;
};

export const rssIntegrationHealth = (
  rssChannelId: string,
  schedulerAvailable: boolean,
): 'ready' | 'unavailable' | 'not_configured' => {
  if (rssChannelId === '') return 'not_configured';
  return schedulerAvailable ? 'ready' : 'unavailable';
};

type MemberProfileCapableRepository = Required<
  Pick<
    EngagementRepository,
    | 'getMemberProfile'
    | 'createMemberProfile'
    | 'updateMemberProfile'
    | 'setMemberProfileVisibility'
    | 'deleteMemberProfile'
  >
>;

const supportsMemberProfiles = (
  repository: EngagementRepository,
): repository is EngagementRepository & MemberProfileCapableRepository =>
  typeof repository.getMemberProfile === 'function' &&
  typeof repository.createMemberProfile === 'function' &&
  typeof repository.updateMemberProfile === 'function' &&
  typeof repository.setMemberProfileVisibility === 'function' &&
  typeof repository.deleteMemberProfile === 'function';

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
