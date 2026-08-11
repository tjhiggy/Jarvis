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
});
