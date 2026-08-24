import { GatewayIntentBits } from 'discord.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import type { AppConfig } from '../src/config/config.js';
import { loadPersona, type TrustedPersona } from '../src/config/persona.js';
import { discordGatewayIntents } from '../src/discord/handlers.js';
import type { FaqCatalog } from '../src/faq/faq-catalog.js';
import type { PollController } from '../src/polls/poll-controller.js';
import type { PollScheduler } from '../src/polls/poll-scheduler.js';
import type { PollStore } from '../src/polls/poll-store.js';
import type {
  BroadcastPolicy,
  BroadcastStore,
} from '../src/notifications/broadcast-store.js';
import type { ProactivePrompt } from '../src/notifications/proactive-catalog.js';
import type { ProactiveEngagementService } from '../src/engagement/proactive.js';
import { RssScheduler } from '../src/notifications/rss-scheduler.js';
import { RssNotificationClient } from '../src/notifications/rss-notifications.js';
import { RssStorage } from '../src/notifications/rss-storage.js';
import { SqliteBroadcastStore } from '../src/notifications/sqlite-broadcast-store.js';
import { ReminderScheduler } from '../src/reminders/reminder-scheduler.js';
import type { ReminderStore } from '../src/reminders/reminder-store.js';
import type { ReminderView } from '../src/reminders/reminder-types.js';
import { SQLiteEngagementRepository } from '../src/storage/engagement-sqlite.js';
import {
  FeatureFlagService,
  SUPPORTED_FEATURE_FLAGS,
} from '../src/engagement/feature-flags.js';
import {
  createCommandDeckRuntimeMutationAdapter,
  createCommandDeckRuntimeMutationApi,
  type AdminConsoleMutationApi,
} from '../src/admin/admin-console.js';
import {
  createApplication,
  nextBroadcastEligibleAt,
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
  imageGeneration: {
    enabled: false,
    channelId: '',
    model: 'gpt-image-1-mini',
    timeoutMs: 60_000,
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
      birthdayId: '',
      rssId: '',
    },
    rssAllowedHosts: [],
    proactiveCatalogPath: '',
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
  it('applies allowlisted broadcast, feature, and RSS changes and compensates an RSS change', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'jarvis-command-deck-'));
    const databasePath = join(directory, 'jarvis.db');
    const broadcast = new SqliteBroadcastStore(databasePath);
    const engagement = new SQLiteEngagementRepository(databasePath);
    const featureFlags = new FeatureFlagService(engagement);
    const rss = new RssStorage(databasePath);
    const auditEvents: unknown[] = [];
    try {
      await broadcast.setPolicy({
        serverId: 'guild-id',
        category: 'rss',
        state: 'enabled',
        channelId: 'channel-id',
        timezone: 'UTC',
        minimumIntervalSeconds: 0,
        digestMode: true,
        updatedAt: new Date('2026-08-23T20:00:00.000Z'),
      });
      const api = createCommandDeckRuntimeMutationApi({
        authorization: {
          token: 'write-token-with-enough-entropy',
          allowedOrigins: [],
          maxClockSkewMs: 60_000,
          replayRetentionMs: 60_000,
          rateLimit: 30,
          rateWindowMs: 60_000,
        },
        databasePath,
        guildId: 'guild-id',
        broadcastStore: broadcast,
        featureFlags,
        rssStorage: rss,
        configuredBroadcasts: [{ category: 'rss', channelId: 'channel-id' }],
        allowedChannelIds: new Set(['channel-id']),
        allowedRssHosts: ['feeds.example.test'],
        rssChannelId: 'channel-id',
        audit: (event) => {
          auditEvents.push(event);
        },
      });

      const credentialCanary = 'rss-user-canary:rss-password-canary';
      const credentialPreview = await api.service.preview({
        type: 'rss_feed',
        operation: 'add',
        url: `https://${credentialCanary}@feeds.example.test/private.xml`,
        label: 'Private feed',
      });
      expect(credentialPreview).toMatchObject({
        ok: false,
        error: { code: 'INVALID_ACTION' },
      });
      expect(JSON.stringify(credentialPreview)).not.toContain(credentialCanary);
      expect(rss.listFeeds('guild-id')).toEqual([]);

      const broadcastAction = {
        type: 'broadcast_state' as const,
        category: 'rss',
        state: 'paused' as const,
      };
      const broadcastPreview = await api.service.preview(broadcastAction);
      expect(broadcastPreview.ok).toBe(true);
      if (!broadcastPreview.ok) throw new Error('Broadcast preview failed.');
      await expect(
        api.service.confirm({
          previewId: broadcastPreview.preview.id,
          action: broadcastAction,
          idempotencyKey: 'broadcast-pause',
        }),
      ).resolves.toMatchObject({ ok: true });
      await expect(
        broadcast.getPolicy('guild-id', 'rss'),
      ).resolves.toMatchObject({ state: 'paused', channelId: 'channel-id' });

      const featureAction = {
        type: 'feature_flag' as const,
        feature: 'trivia',
        enabled: false,
      };
      const featurePreview = await api.service.preview(featureAction);
      expect(featurePreview.ok).toBe(true);
      if (!featurePreview.ok) throw new Error('Feature preview failed.');
      await expect(
        api.service.confirm({
          previewId: featurePreview.preview.id,
          action: featureAction,
          idempotencyKey: 'feature-disable',
        }),
      ).resolves.toMatchObject({ ok: true });
      await expect(featureFlags.isEnabled('guild-id', 'trivia')).resolves.toBe(
        false,
      );

      const rssAction = {
        type: 'rss_feed' as const,
        operation: 'add' as const,
        url: 'https://feeds.example.test/news.xml',
        label: 'Ship News',
      };
      const rssPreview = await api.service.preview(rssAction);
      expect(rssPreview.ok).toBe(true);
      if (!rssPreview.ok) throw new Error('RSS preview failed.');
      const rssConfirmation = await api.service.confirm({
        previewId: rssPreview.preview.id,
        action: rssAction,
        idempotencyKey: 'rss-add',
      });
      expect(rssConfirmation.ok).toBe(true);
      if (!rssConfirmation.ok) throw new Error('RSS confirmation failed.');
      expect(rss.listFeeds('guild-id')).toEqual([
        expect.objectContaining({
          url: rssAction.url,
          label: 'Ship News',
        }),
      ]);

      const rollbackPreview = await api.service.previewRollback(
        rssConfirmation.receipt.rollbackToken!,
      );
      expect(rollbackPreview.ok).toBe(true);
      if (!rollbackPreview.ok) throw new Error('Rollback preview failed.');
      await expect(
        api.service.confirmRollback({
          previewId: rollbackPreview.preview.id,
          idempotencyKey: 'rss-add-rollback',
        }),
      ).resolves.toMatchObject({ ok: true });
      expect(rss.listFeeds('guild-id')).toEqual([]);
      expect(JSON.stringify(auditEvents)).not.toContain('feeds.example.test');
      expect(JSON.stringify(auditEvents)).not.toContain('Ship News');
      expect(JSON.stringify(auditEvents)).not.toContain('rss-user-canary');
      const persisted = new Database(databasePath, { readonly: true });
      const persistedMutationValues = persisted
        .prepare(
          `SELECT action_json || before_json || after_json || expected_json AS value
           FROM command_deck_mutation_previews
           UNION ALL
           SELECT url || label AS value FROM rss_feeds`,
        )
        .all() as { readonly value: string }[];
      persisted.close();
      expect(JSON.stringify(persistedMutationValues)).not.toContain(
        'rss-user-canary',
      );
      expect(JSON.stringify(persistedMutationValues)).not.toContain(
        'rss-password-canary',
      );
    } finally {
      rss.close();
      await engagement.closeConnection();
      await broadcast.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('persists operation status across adapter instances and rejects a stale compare-and-set', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'jarvis-command-deck-cas-'));
    const databasePath = join(directory, 'jarvis.db');
    const broadcast = new SqliteBroadcastStore(databasePath);
    const engagement = new SQLiteEngagementRepository(databasePath);
    const featureFlags = new FeatureFlagService(engagement);
    const rss = new RssStorage(databasePath);
    try {
      await broadcast.setPolicy({
        serverId: 'guild-id',
        category: 'rss',
        state: 'enabled',
        channelId: 'channel-id',
        timezone: 'UTC',
        minimumIntervalSeconds: 0,
        digestMode: true,
        updatedAt: new Date('2026-08-23T20:00:00.000Z'),
      });
      const options = {
        databasePath,
        guildId: 'guild-id',
        broadcastStore: broadcast,
        featureFlags,
        rssStorage: rss,
        configuredBroadcasts: [
          { category: 'rss' as const, channelId: 'channel-id' },
        ],
        allowedChannelIds: new Set(['channel-id']),
        allowedRssHosts: ['feeds.example.test'],
        rssChannelId: 'channel-id',
      };
      const action = {
        type: 'broadcast_state' as const,
        category: 'rss',
        state: 'paused' as const,
      };
      const first = createCommandDeckRuntimeMutationAdapter(options);
      await expect(
        first.apply({
          action,
          expectedValue: true,
          nextValue: false,
          operationId: 'durable-operation',
        }),
      ).resolves.toBe('applied');

      const reopened = createCommandDeckRuntimeMutationAdapter(options);
      await expect(reopened.operationStatus('durable-operation')).resolves.toBe(
        'applied',
      );
      await broadcast.setPolicy({
        ...(await broadcast.getPolicy('guild-id', 'rss'))!,
        state: 'enabled',
        updatedAt: new Date('2026-08-23T20:01:00.000Z'),
      });
      await expect(
        reopened.apply({
          action,
          expectedValue: true,
          nextValue: false,
          operationId: 'durable-operation',
        }),
      ).resolves.toBe('already_applied');
      await expect(
        broadcast.getPolicy('guild-id', 'rss'),
      ).resolves.toMatchObject({ state: 'enabled' });
      await expect(
        reopened.apply({
          action,
          expectedValue: false,
          nextValue: true,
          operationId: 'stale-operation',
        }),
      ).resolves.toBe('precondition_failed');
      await expect(reopened.operationStatus('stale-operation')).resolves.toBe(
        'not_applied',
      );
    } finally {
      rss.close();
      await engagement.closeConnection();
      await broadcast.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('replays the original receipt and completes rollback after mutation-service restarts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'jarvis-command-deck-state-'));
    const databasePath = join(directory, 'jarvis.db');
    const broadcast = new SqliteBroadcastStore(databasePath);
    const engagement = new SQLiteEngagementRepository(databasePath);
    const featureFlags = new FeatureFlagService(engagement);
    const rss = new RssStorage(databasePath);
    try {
      const options = {
        authorization: {
          token: 'write-token-with-enough-entropy',
          allowedOrigins: [],
          maxClockSkewMs: 60_000,
          replayRetentionMs: 60_000,
          rateLimit: 30,
          rateWindowMs: 60_000,
        },
        databasePath,
        guildId: 'guild-id',
        broadcastStore: broadcast,
        featureFlags,
        rssStorage: rss,
        configuredBroadcasts: [] as const,
        allowedChannelIds: new Set(['rss-channel']),
        allowedRssHosts: ['feeds.example.test'],
        rssChannelId: 'rss-channel',
      };
      const action = {
        type: 'rss_feed' as const,
        operation: 'add' as const,
        url: 'https://feeds.example.test/restart.xml',
        label: 'Restart feed',
      };
      const firstService = createCommandDeckRuntimeMutationApi(options).service;
      const preview = await firstService.preview(action);
      expect(preview.ok).toBe(true);
      if (!preview.ok) throw new Error('Restart preview failed.');
      const firstConfirmation = await firstService.confirm({
        previewId: preview.preview.id,
        action,
        idempotencyKey: 'restart-confirmation',
      });
      expect(firstConfirmation.ok).toBe(true);
      if (!firstConfirmation.ok)
        throw new Error('Restart confirmation failed.');

      const restartedService =
        createCommandDeckRuntimeMutationApi(options).service;
      await expect(
        restartedService.confirm({
          previewId: preview.preview.id,
          action,
          idempotencyKey: 'restart-confirmation',
        }),
      ).resolves.toEqual(firstConfirmation);
      expect(rss.listFeeds('guild-id')).toHaveLength(1);

      const rollbackPreview = await restartedService.previewRollback(
        firstConfirmation.receipt.rollbackToken!,
      );
      expect(rollbackPreview.ok).toBe(true);
      if (!rollbackPreview.ok)
        throw new Error('Restart rollback preview failed.');

      const rollbackRestart =
        createCommandDeckRuntimeMutationApi(options).service;
      const rollbackConfirmation = await rollbackRestart.confirmRollback({
        previewId: rollbackPreview.preview.id,
        idempotencyKey: 'restart-rollback-confirmation',
      });
      expect(rollbackConfirmation.ok).toBe(true);
      expect(rss.listFeeds('guild-id')).toEqual([]);

      const finalRestart = createCommandDeckRuntimeMutationApi(options).service;
      await expect(
        finalRestart.confirmRollback({
          previewId: rollbackPreview.preview.id,
          idempotencyKey: 'restart-rollback-confirmation',
        }),
      ).resolves.toEqual(rollbackConfirmation);
    } finally {
      rss.close();
      await engagement.closeConnection();
      await broadcast.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('recovers an applied operation after preview expiry but leaves an unapplied expired preview stale', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'jarvis-command-deck-crash-'));
    const databasePath = join(directory, 'jarvis.db');
    const broadcast = new SqliteBroadcastStore(databasePath);
    const engagement = new SQLiteEngagementRepository(databasePath);
    const featureFlags = new FeatureFlagService(engagement);
    const rss = new RssStorage(databasePath);
    let currentTime = new Date('2026-08-23T20:00:00.000Z');
    try {
      const options = {
        authorization: {
          token: 'write-token-with-enough-entropy',
          allowedOrigins: [],
          maxClockSkewMs: 60_000,
          replayRetentionMs: 60_000,
          rateLimit: 30,
          rateWindowMs: 60_000,
        },
        databasePath,
        guildId: 'guild-id',
        broadcastStore: broadcast,
        featureFlags,
        rssStorage: rss,
        configuredBroadcasts: [] as const,
        allowedChannelIds: new Set(['rss-channel']),
        allowedRssHosts: ['feeds.example.test'],
        rssChannelId: 'rss-channel',
        now: () => currentTime,
      };
      const appliedAction = {
        type: 'rss_feed' as const,
        operation: 'add' as const,
        url: 'https://feeds.example.test/crash.xml',
        label: 'Crash recovery feed',
      };
      const staleAction = {
        type: 'rss_feed' as const,
        operation: 'add' as const,
        url: 'https://feeds.example.test/stale.xml',
        label: 'Must stay absent',
      };
      const firstService = createCommandDeckRuntimeMutationApi(options).service;
      const appliedPreview = await firstService.preview(appliedAction);
      const stalePreview = await firstService.preview(staleAction);
      expect(appliedPreview.ok).toBe(true);
      expect(stalePreview.ok).toBe(true);
      if (!appliedPreview.ok || !stalePreview.ok)
        throw new Error('Crash-window preview failed.');

      const database = new Database(databasePath, { readonly: true });
      const operation = database
        .prepare(
          `SELECT operation_id AS operationId
           FROM command_deck_mutation_previews
           WHERE preview_id = ?`,
        )
        .get(appliedPreview.preview.id) as { readonly operationId: string };
      database.close();
      const adapter = createCommandDeckRuntimeMutationAdapter(options);
      await expect(
        adapter.apply({
          action: appliedAction,
          expectedValue: undefined,
          nextValue: {
            url: appliedAction.url,
            label: appliedAction.label,
          },
          operationId: operation.operationId,
        }),
      ).resolves.toBe('applied');

      currentTime = new Date('2026-08-23T20:06:00.000Z');
      const restartedService =
        createCommandDeckRuntimeMutationApi(options).service;
      const recovered = await restartedService.confirm({
        previewId: appliedPreview.preview.id,
        action: appliedAction,
        idempotencyKey: 'expired-applied-recovery',
      });
      expect(recovered.ok).toBe(true);
      if (!recovered.ok) throw new Error('Applied recovery failed.');
      expect(recovered.receipt.rollbackToken).toBeTruthy();
      expect(rss.listFeeds('guild-id')).toEqual([
        expect.objectContaining({ url: appliedAction.url }),
      ]);

      await expect(
        restartedService.confirm({
          previewId: stalePreview.preview.id,
          action: staleAction,
          idempotencyKey: 'expired-unapplied-rejection',
        }),
      ).resolves.toMatchObject({
        ok: false,
        error: { code: 'PREVIEW_STALE' },
      });
      expect(rss.listFeeds('guild-id')).toEqual([
        expect.objectContaining({ url: appliedAction.url }),
      ]);

      const rollbackPreview = await restartedService.previewRollback(
        recovered.receipt.rollbackToken!,
      );
      expect(rollbackPreview.ok).toBe(true);
      if (!rollbackPreview.ok)
        throw new Error('Recovered rollback preview failed.');
      await expect(
        restartedService.confirmRollback({
          previewId: rollbackPreview.preview.id,
          idempotencyKey: 'expired-applied-rollback',
        }),
      ).resolves.toMatchObject({ ok: true });
      expect(rss.listFeeds('guild-id')).toEqual([]);
    } finally {
      rss.close();
      await engagement.closeConnection();
      await broadcast.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('passes a configuration-scoped mutation API into the Admin Console', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'jarvis-command-deck-wire-'));
    const databasePath = join(directory, 'jarvis.db');
    let mutationApi: AdminConsoleMutationApi | undefined;
    try {
      const application = await createTestApplication({
        loadConfig: () => ({
          ...config,
          adminConsole: {
            enabled: true,
            port: 0,
            host: '127.0.0.1',
            token: 'local-admin-token-with-32-characters-minimum',
            readApi: {
              token: 'r'.repeat(32),
              allowedOrigins: ['https://deck.example.test'],
              rateLimit: 30,
              rateWindowMs: 60_000,
              maxClockSkewMs: 60_000,
              replayRetentionMs: 60_000,
            },
          },
          storage: { ...config.storage, databasePath },
          security: {
            ...config.security,
            allowedChannelIds: new Set(['rss-channel']),
          },
          engagement: {
            ...config.engagement,
            enabled: true,
            channels: {
              ...config.engagement.channels,
              rssId: 'rss-channel',
            },
            rssAllowedHosts: ['feeds.example.test'],
          },
        }),
        loadPersona: async () => ({}) as TrustedPersona,
        createStore: () => conversationStore(),
        createAIService: () => ({ respond: async () => ({ text: 'unused' }) }),
        createDiscordClient: () => ({
          user: { id: 'bot-id' },
          channels: {
            fetch: async () => ({
              name: 'jarvis-updates',
              send: async () => ({ id: 'message-id' }),
            }),
          },
          on: () => undefined,
          login: async () => undefined,
          destroy: () => undefined,
        }),
        startAdminConsole: async (options) => {
          mutationApi = options.mutationApi;
          return {
            server: {} as never,
            close: async () => undefined,
          };
        },
        timers: inertTimers(),
      });

      expect(mutationApi).toBeDefined();
      expect(mutationApi?.catalog).toEqual({
        broadcastCategories: ['rss'],
        featureFlags: [...SUPPORTED_FEATURE_FLAGS],
        rssHosts: ['feeds.example.test'],
      });
      expect(mutationApi?.authorization.token).toBe(
        'local-admin-token-with-32-characters-minimum',
      );
      await application.shutdown();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('initializes private member statistics when engagement is disabled', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'jarvis-member-stats-'));
    const databasePath = join(directory, 'jarvis.db');
    try {
      const application = await createTestApplication({
        loadConfig: () => ({
          ...config,
          storage: { ...config.storage, databasePath },
          engagement: { ...config.engagement, enabled: false },
        }),
        loadPersona: async () => ({}) as TrustedPersona,
        createStore: () => conversationStore(),
        createBroadcastStore: () => broadcastStore(),
        createAIService: () => ({ respond: async () => ({ text: 'unused' }) }),
        createDiscordClient: () => ({
          user: { id: 'bot-id' },
          on: () => undefined,
          login: async () => undefined,
          destroy: () => undefined,
        }),
        timers: inertTimers(),
      });
      const database = new Database(databasePath, { readonly: true });
      const tables = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'member_statistics_%' ORDER BY name",
        )
        .all() as { name: string }[];
      database.close();
      expect(tables.map(({ name }) => name)).toEqual([
        'member_statistics_daily',
        'member_statistics_preferences',
      ]);
      await application.shutdown();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('moves a cadence-eligible broadcast past its configured quiet hours', () => {
    expect(
      nextBroadcastEligibleAt(
        {
          serverId: 'server',
          category: 'rss',
          state: 'enabled',
          channelId: 'channel',
          timezone: 'UTC',
          quietStartMinute: 9 * 60,
          quietEndMinute: 10 * 60,
          minimumIntervalSeconds: 0,
          digestMode: false,
          updatedAt: new Date('2026-08-11T08:00:00.000Z'),
        },
        undefined,
        new Date('2026-08-11T09:30:00.000Z'),
      ),
    ).toEqual(new Date('2026-08-11T10:00:00.000Z'));
  });

  it('provisions shared policy for recap, event reminders, birthdays, and trivia before starting their schedulers', async () => {
    const policies: BroadcastPolicy[] = [];
    const application = await createTestApplication({
      loadConfig: () => ({
        ...config,
        security: {
          ...config.security,
          allowedChannelIds: new Set([
            'recaps',
            'events',
            'birthdays',
            'activity',
          ]),
        },
        engagement: {
          ...config.engagement,
          enabled: true,
          channels: {
            ...config.engagement.channels,
            recapId: 'recaps',
            eventId: 'events',
            birthdayId: 'birthdays',
            activityId: 'activity',
          },
          recapSchedule: 'MONDAY 12:00',
        },
      }),
      loadPersona: async () => ({}) as TrustedPersona,
      createEngagementRepository: () =>
        ({
          getFeatureFlags: async () => [],
          setFeatureFlag: async () => undefined,
          getBirthday: async () => undefined,
          saveBirthday: async (record: any) => record,
          deleteBirthday: async () => false,
          listDueBirthdays: async () => [],
          claimBirthdayAnnouncement: async () => false,
          engagementPaused: async () => false,
          cleanup: async () => 0,
          closeConnection: async () => undefined,
        }) as any,
      createBroadcastStore: () =>
        broadcastStore({
          getPolicy: async (_serverId, category) =>
            policies.find((policy) => policy.category === category),
          setPolicy: async (policy) => {
            policies.push(policy);
          },
        }),
      createStore: () => conversationStore(),
      createAIService: () => ({ respond: async () => ({ text: 'unused' }) }),
      createDiscordClient: () => ({
        user: { id: 'bot-id' },
        on: () => undefined,
        login: async () => undefined,
        destroy: () => undefined,
      }),
      timers: inertTimers(),
    });

    expect(policies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: 'recap', channelId: 'recaps' }),
        expect.objectContaining({
          category: 'event_reminder',
          channelId: 'events',
        }),
        expect.objectContaining({
          category: 'birthday',
          channelId: 'birthdays',
        }),
        expect.objectContaining({ category: 'trivia', channelId: 'activity' }),
      ]),
    );
    await application.shutdown();
  });

  it('rechecks the persisted engagement pause before proactive channel delivery', async () => {
    let paused = false;
    let posted = 0;
    let proactiveService: ProactiveEngagementService | undefined;
    let policy: BroadcastPolicy | undefined;
    const application = await createTestApplication({
      loadConfig: () => ({
        ...config,
        security: {
          ...config.security,
          allowedChannelIds: new Set(['channel-id']),
        },
        engagement: {
          ...config.engagement,
          enabled: true,
          channels: { ...config.engagement.channels, activityId: 'channel-id' },
          proactiveCatalogPath: './config/approved-prompts.json',
        },
      }),
      loadPersona: async () => ({}) as TrustedPersona,
      loadProactiveCatalog: async () => [
        {
          id: 'crew-check-in',
          category: 'community',
          text: 'Crew check-in: what is everyone playing today?',
          active: true,
        },
      ],
      createEngagementRepository: () =>
        ({
          getFeatureFlags: async () => [],
          setFeatureFlag: async () => undefined,
          getProactiveState: async () => ({ state: 'enabled' as const }),
          setProactiveState: async () => undefined,
          recordProactivePosted: async () => undefined,
          engagementPaused: async () => paused,
          cleanup: async () => 0,
          closeConnection: async () => undefined,
        }) as any,
      createBroadcastStore: () =>
        broadcastStore({
          getPolicy: async () => policy,
          setPolicy: async (next) => {
            policy = next;
          },
          claimDelivery: async () => {
            paused = true;
            return 'lease-token';
          },
          completeDelivery: async () => true,
          releaseDelivery: async () => true,
        }),
      createProactiveScheduler: (service) => {
        proactiveService = service;
        return { start: () => undefined, stop: async () => undefined };
      },
      createStore: () => conversationStore(),
      createAIService: () => ({ respond: async () => ({ text: 'unused' }) }),
      createDiscordClient: () => ({
        user: { id: 'bot-id' },
        channels: {
          fetch: async () => ({
            send: async () => {
              posted += 1;
            },
          }),
        },
        on: () => undefined,
        login: async () => undefined,
        destroy: () => undefined,
      }),
      timers: inertTimers(),
    });

    await expect(proactiveService!.tick()).resolves.toBe(false);
    expect(posted).toBe(0);
    await application.shutdown();
  });

  it('waits for a blocked proactive scheduler before closing broadcast storage', async () => {
    const events: string[] = [];
    let releaseStop = (): void => undefined;
    let signalStopStarted = (): void => undefined;
    const stopBlocked = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    const stopStarted = new Promise<void>((resolve) => {
      signalStopStarted = resolve;
    });
    const application = await createTestApplication({
      loadConfig: () => ({
        ...config,
        security: {
          ...config.security,
          allowedChannelIds: new Set(['channel-id']),
        },
        engagement: {
          ...config.engagement,
          enabled: true,
          channels: { ...config.engagement.channels, activityId: 'channel-id' },
          proactiveCatalogPath: './config/approved-prompts.json',
        },
      }),
      loadPersona: async () => ({}) as TrustedPersona,
      loadProactiveCatalog: async () => [
        {
          id: 'crew-check-in',
          category: 'community',
          text: 'Crew check-in: what is everyone playing today?',
          active: true,
        },
      ],
      createEngagementRepository: () =>
        ({
          getFeatureFlags: async () => [],
          setFeatureFlag: async () => undefined,
          getProactiveState: async () => ({ state: 'disabled' as const }),
          setProactiveState: async () => undefined,
          recordProactivePosted: async () => undefined,
          engagementPaused: async () => false,
          cleanup: async () => 0,
          closeConnection: async () => undefined,
        }) as any,
      createBroadcastStore: () =>
        broadcastStore({
          getPolicy: async () => undefined,
          setPolicy: async () => undefined,
          close: async () => {
            events.push('broadcast-store-close');
          },
        }),
      createProactiveScheduler: () => ({
        start: () => {
          events.push('proactive-start');
        },
        stop: async () => {
          events.push('proactive-stop-start');
          signalStopStarted();
          await stopBlocked;
          events.push('proactive-stop-end');
        },
      }),
      createStore: () => conversationStore(),
      createAIService: () => ({ respond: async () => ({ text: 'unused' }) }),
      createDiscordClient: () => ({
        user: { id: 'bot-id' },
        on: () => undefined,
        login: async () => undefined,
        destroy: () => undefined,
      }),
      timers: inertTimers(),
    });

    const stopping = application.shutdown();
    await stopStarted;
    expect(events).toEqual(['proactive-start', 'proactive-stop-start']);

    releaseStop();
    await stopping;
    expect(events).toEqual([
      'proactive-start',
      'proactive-stop-start',
      'proactive-stop-end',
      'broadcast-store-close',
    ]);
  });

  it('stops RSS scheduling before closing RSS storage during shutdown', async () => {
    const events: string[] = [];
    const stop = vi
      .spyOn(RssScheduler.prototype, 'stop')
      .mockImplementation(async () => {
        events.push('rss-stop');
      });
    const close = vi
      .spyOn(RssStorage.prototype, 'close')
      .mockImplementation(() => {
        events.push('rss-storage-close');
      });
    try {
      const application = await createTestApplication({
        loadConfig: () => ({
          ...config,
          engagement: {
            ...config.engagement,
            enabled: true,
            channels: { ...config.engagement.channels, rssId: 'channel-id' },
            rssAllowedHosts: ['news.example.com'],
            adminRoleIds: new Set(['12345678901234567']),
          },
        }),
        loadPersona: async () => ({}) as TrustedPersona,
        createStore: () => conversationStore(),
        createAIService: () => ({ respond: async () => ({ text: 'unused' }) }),
        createDiscordClient: () => ({
          user: { id: 'bot-id' },
          on: () => undefined,
          login: async () => undefined,
          destroy: () => undefined,
        }),
        timers: inertTimers(),
      });

      await application.shutdown();
      expect(events).toEqual(['rss-stop', 'rss-storage-close']);
    } finally {
      stop.mockRestore();
      close.mockRestore();
    }
  });

  it('drains an in-flight RSS tick before closing RSS storage during shutdown', async () => {
    let rssInterval: (() => void) | undefined;
    let releaseFetch = (): void => undefined;
    const fetchStarted = deferred<void>();
    const fetchBlocked = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    const storageClosed = vi.fn();
    const setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation(((
      callback: () => void,
      delay?: number,
    ) => {
      if (delay === 300_000) rssInterval = callback;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval);
    const clearIntervalSpy = vi
      .spyOn(global, 'clearInterval')
      .mockImplementation(() => undefined);
    const listFeeds = vi
      .spyOn(RssStorage.prototype, 'listFeeds')
      .mockReturnValue([
        {
          serverId: 'guild-id',
          url: 'https://news.example.com/feed.xml',
          label: 'News',
          paused: false,
          baselined: true,
        },
      ]);
    const fetch = vi
      .spyOn(RssNotificationClient.prototype, 'fetch')
      .mockImplementation(async () => {
        fetchStarted.resolve();
        await fetchBlocked;
        return [];
      });
    const close = vi
      .spyOn(RssStorage.prototype, 'close')
      .mockImplementation(storageClosed);
    try {
      const application = await createTestApplication({
        loadConfig: () => ({
          ...config,
          engagement: {
            ...config.engagement,
            enabled: true,
            channels: { ...config.engagement.channels, rssId: 'channel-id' },
            rssAllowedHosts: ['news.example.com'],
            adminRoleIds: new Set(['12345678901234567']),
          },
        }),
        loadPersona: async () => ({}) as TrustedPersona,
        createStore: () => conversationStore(),
        createAIService: () => ({ respond: async () => ({ text: 'unused' }) }),
        createDiscordClient: () => ({
          user: { id: 'bot-id' },
          on: () => undefined,
          login: async () => undefined,
          destroy: () => undefined,
        }),
        timers: inertTimers(),
      });

      rssInterval?.();
      await fetchStarted.promise;
      const stopping = application.shutdown();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(storageClosed).not.toHaveBeenCalled();

      releaseFetch();
      await stopping;
      expect(storageClosed).toHaveBeenCalledOnce();
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
      listFeeds.mockRestore();
      fetch.mockRestore();
      close.mockRestore();
    }
  });

  it('loads the configured approved proactive catalog before application startup', async () => {
    const catalogPaths: string[] = [];
    const application = await createTestApplication({
      loadConfig: () => ({
        ...config,
        engagement: {
          ...config.engagement,
          proactiveCatalogPath: './config/approved-prompts.json',
        },
      }),
      loadPersona: async () => ({}) as TrustedPersona,
      loadProactiveCatalog: async (path) => {
        catalogPaths.push(path);
        return [
          {
            id: 'crew-check-in',
            category: 'community',
            text: 'Crew check-in: what is everyone playing today?',
            active: true,
          },
        ] satisfies readonly ProactivePrompt[];
      },
      createStore: () => conversationStore(),
      createAIService: () => ({ respond: async () => ({ text: 'unused' }) }),
      createDiscordClient: () => ({
        user: { id: 'bot-id' },
        on: () => undefined,
        login: async () => undefined,
        destroy: () => undefined,
      }),
      timers: inertTimers(),
    });

    expect(catalogPaths).toEqual(['./config/approved-prompts.json']);
    await application.shutdown();
  });

  it('shares the configured database with notification preferences and closes it after active command work drains', async () => {
    const events: string[] = [];
    const listeners = new Map<string, (...args: unknown[]) => unknown>();
    let releaseResponse = (): void => undefined;
    let signalReplyStarted = (): void => undefined;
    const responseCompleted = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const replyStarted = new Promise<void>((resolve) => {
      signalReplyStarted = () => resolve();
    });
    const application = await createTestApplication({
      loadConfig: () => config,
      loadPersona: async () => ({}) as TrustedPersona,
      createStore: () => conversationStore(),
      createReminderStore: () => reminderStore(),
      createBroadcastStore: (path) => {
        events.push(`broadcast-store:${path}`);
        return broadcastStore({
          close: async () => {
            events.push('broadcast-store-close');
          },
        });
      },
      createAIService: () => ({ respond: async () => ({ text: 'unused' }) }),
      createDiscordClient: () => ({
        user: { id: 'bot-id' },
        on: (event, listener) => {
          listeners.set(event, listener);
        },
        login: async () => undefined,
        destroy: () => undefined,
      }),
    });

    listeners.get('interactionCreate')?.({
      isChatInputCommand: () => true,
      id: 'notifications-1',
      commandName: 'notifications',
      guildId: 'guild-id',
      channelId: 'channel-id',
      channel: { parentId: null, isThread: () => false },
      user: { id: 'crew-member-1' },
      options: { getSubcommand: () => 'status', getString: () => null },
      deferReply: async () => undefined,
      fetchReply: async () => ({ id: 'reply-id' }),
      reply: async () => {
        signalReplyStarted();
        await responseCompleted;
      },
    });
    await replyStarted;
    const stopping = application.shutdown();
    expect(events).toEqual(['broadcast-store::memory:']);
    releaseResponse();
    await stopping;
    expect(events).toEqual([
      'broadcast-store::memory:',
      'broadcast-store-close',
    ]);
  });

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

  it('drains active periodic engagement cleanup before closing engagement SQLite', async () => {
    const intervalCallbacks: Array<() => void> = [];
    const events: string[] = [];
    let releaseCleanup!: () => void;
    const cleanupBlocked = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    let announceCleanupStarted!: () => void;
    const cleanupStarted = new Promise<void>((resolve) => {
      announceCleanupStarted = resolve;
    });
    let cleanupCalls = 0;
    const engagementRepository = {
      expireTriviaRounds: async () => 0,
      listExpiredIntroductions: async () => [],
      listCleanupPendingSuggestions: async () => [],
      listPendingCardDeletions: async () => [],
      completeCardDeletion: async () => true,
      cleanup: async () => {
        cleanupCalls += 1;
        if (cleanupCalls === 2) {
          events.push('cleanup-start');
          announceCleanupStarted();
          await cleanupBlocked;
          events.push('cleanup-end');
        }
        return 0;
      },
      closeConnection: async () => {
        events.push('engagement-close');
      },
    } as any;
    const application = await createTestApplication({
      loadConfig: () => ({
        ...config,
        engagement: { ...config.engagement, enabled: true },
      }),
      loadPersona: async () => ({}) as TrustedPersona,
      createEngagementRepository: () => engagementRepository,
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
        login: async () => 'logged-in',
        destroy: () => undefined,
      }),
      timers: {
        setInterval: (callback) => {
          intervalCallbacks.push(callback);
          return callback;
        },
        clearInterval: () => undefined,
      },
    });

    intervalCallbacks.at(-1)?.();
    await cleanupStarted;
    const shuttingDown = application.shutdown();
    await Promise.resolve();
    expect(events).toEqual(['cleanup-start']);
    releaseCleanup();
    await shuttingDown;
    expect(events).toEqual([
      'cleanup-start',
      'cleanup-end',
      'engagement-close',
    ]);
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

function broadcastStore(
  overrides: Partial<BroadcastStore & { close(): Promise<void> }> = {},
): BroadcastStore & { close(): Promise<void> } {
  return {
    getPolicy: async () => undefined,
    setPolicy: async () => undefined,
    getMemberPreference: async () => undefined,
    setMemberPreference: async () => undefined,
    claimDelivery: async () => undefined,
    completeDelivery: async () => false,
    releaseDelivery: async () => false,
    deliveryHealth: async () => undefined,
    latestDeliveryHealth: async () => undefined,
    getLatestCompletedAt: async () => undefined,
    cleanup: async () => 0,
    close: async () => undefined,
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
