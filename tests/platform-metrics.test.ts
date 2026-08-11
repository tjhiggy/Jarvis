import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createAnalyticsEvent,
  type InteractionContext,
} from '../src/platform/contracts.js';
import { SQLiteEngagementRepository } from '../src/storage/engagement-sqlite.js';

describe('platform aggregate metrics', () => {
  let directory: string;
  let repository: SQLiteEngagementRepository;

  const context: InteractionContext = {
    serverId: 'server-1',
    channelId: 'channel-1',
    userId: 'user-1',
    correlationId: 'correlation-1',
    surface: 'discord',
    isAdministrator: false,
  };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'jarvis-metrics-'));
    repository = new SQLiteEngagementRepository(
      join(directory, 'engagement.db'),
    );
  });

  afterEach(async () => {
    await repository.closeConnection();
    await rm(directory, { recursive: true, force: true });
  });

  it('aggregates events by server, feature, command, and event name', async () => {
    await repository.recordAnalyticsEvent(
      createAnalyticsEvent({
        name: 'command_succeeded',
        context,
        feature: 'rss',
        command: 'rss list',
        result: 'success',
        durationMs: 10,
      }),
    );
    await repository.recordAnalyticsEvent(
      createAnalyticsEvent({
        name: 'command_succeeded',
        context,
        feature: 'rss',
        command: 'rss list',
        result: 'success',
        durationMs: 20,
      }),
    );

    await expect(
      repository.analyticsSummary(
        'server-1',
        new Date(Date.now() - 86_400_000),
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        serverId: 'server-1',
        feature: 'rss',
        command: 'rss list',
        eventName: 'command_succeeded',
        count: 2,
        durationMs: 30,
      }),
    ]);
  });

  it('isolates metrics by server and excludes older days', async () => {
    await repository.recordAnalyticsEvent(
      createAnalyticsEvent({
        name: 'command_failed',
        context: { ...context, serverId: 'server-2' },
        feature: 'rss',
        command: 'rss add',
        result: 'failure',
      }),
    );
    await expect(
      repository.analyticsSummary(
        'server-1',
        new Date(Date.now() - 86_400_000),
      ),
    ).resolves.toEqual([]);
    await expect(
      repository.analyticsSummary(
        'server-2',
        new Date(Date.now() - 86_400_000),
      ),
    ).resolves.toHaveLength(1);
  });

  it('stores only bounded content-free delivery aggregates and scopes summaries to one server', async () => {
    await repository.recordDeliveryMetric({
      serverId: 'server-1',
      category: 'rss',
      name: 'delivery_attempted',
      occurredAt: '2026-08-11T16:00:00.000Z',
      durationMs: 12,
    });
    await repository.recordDeliveryMetric({
      serverId: 'server-1',
      category: 'rss',
      name: 'delivery_succeeded',
      occurredAt: '2026-08-11T16:00:01.000Z',
      durationMs: 8,
    });
    await repository.recordDeliveryMetric({
      serverId: 'server-2',
      category: 'rss',
      name: 'delivery_failed',
      occurredAt: '2026-08-11T16:00:02.000Z',
      durationMs: 3,
    });

    await expect(
      repository.deliveryMetricsSummary(
        'server-1',
        new Date('2026-08-05T00:00:00.000Z'),
      ),
    ).resolves.toEqual([
      {
        serverId: 'server-1',
        category: 'rss',
        eventName: 'delivery_attempted',
        count: 1,
        durationMs: 12,
      },
      {
        serverId: 'server-1',
        category: 'rss',
        eventName: 'delivery_succeeded',
        count: 1,
        durationMs: 8,
      },
    ]);
  });
});
