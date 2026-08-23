import { describe, expect, it } from 'vitest';
import type { AdminConsoleSnapshot } from '../src/admin/admin-console.js';
import { projectCommandDeckReadSnapshot } from '../src/admin/command-deck-read-api.js';

const observedAt = new Date('2026-08-23T20:00:00.000Z');

describe('Command Deck read projection', () => {
  it('projects a versioned, bounded operational snapshot', () => {
    const result = projectCommandDeckReadSnapshot(safeSnapshot(), observedAt);

    expect(result).toEqual({
      schemaVersion: '1.0',
      observedAt: observedAt.toISOString(),
      freshness: { state: 'fresh', staleAfterSeconds: 60 },
      release: { version: '1.6.0', environment: 'test' },
      health: { state: 'degraded', reason: 'integration_attention' },
      providers: [
        { id: 'openai', state: 'configured', selected: true },
        { id: 'ollama', state: 'disabled', selected: false },
        { id: 'web_search', state: 'configured', selected: false },
      ],
      integrations: [
        { id: 'rss', state: 'unavailable' },
        { id: 'sleeper', state: 'configured' },
        { id: 'github', state: 'disabled' },
      ],
      schedulers: [
        {
          id: 'rss',
          state: 'enabled',
          health: 'degraded',
          lastSuccessAt: '2026-08-23T19:55:00.000Z',
        },
      ],
      featureFlags: ['trivia', 'events'],
      metrics: { events: 12, failures: 1, windowDays: 7 },
      audit: { state: 'ready' },
    });
  });

  it('reports an unavailable database without pretending configured providers are live', () => {
    const snapshot = safeSnapshot({
      database: 'unavailable',
      integrations: { rss: 'ready', sleeper: true, github: true },
      metrics: null,
    });

    const result = projectCommandDeckReadSnapshot(snapshot, observedAt);

    expect(result.health).toEqual({
      state: 'unavailable',
      reason: 'database_unavailable',
    });
    expect(JSON.stringify(result.providers)).not.toContain('healthy');
    expect(result.metrics).toBeNull();
  });

  it('drops unsafe extension fields and bounds configured labels and numbers', () => {
    const canary = 'canary-secret-do-not-serialize';
    const snapshot = {
      ...safeSnapshot(),
      engagement: {
        enabled: true,
        features: ['trivia', canary, 'events', ...Array(60).fill('extra')],
      },
      metrics: {
        events: Number.MAX_SAFE_INTEGER,
        failures: -5,
      },
      token: canary,
      memberId: '123456789012345678',
      message: 'private member content',
      prompt: 'summarize everything',
      url: `https://operator:${canary}@example.test/feed?key=${canary}`,
    } as unknown as AdminConsoleSnapshot;

    const serialized = JSON.stringify(
      projectCommandDeckReadSnapshot(snapshot, observedAt),
    );

    expect(serialized).not.toMatch(
      /canary|123456789012345678|private member|prompt|operator|example\.test|key=/i,
    );
    const result = JSON.parse(serialized) as {
      featureFlags: string[];
      metrics: { events: number; failures: number };
    };
    expect(result.featureFlags).toEqual(['trivia', 'events']);
    expect(result.metrics).toMatchObject({ events: 1_000_000_000, failures: 0 });
  });
});

function safeSnapshot(
  overrides: Partial<AdminConsoleSnapshot> = {},
): AdminConsoleSnapshot {
  return {
    platform: { version: '1.6.0', environment: 'test' },
    database: 'healthy',
    engagement: { enabled: true, features: ['trivia', 'events'] },
    providers: {
      ai: 'openai',
      openAiConfigured: true,
      ollamaConfigured: false,
      webSearchConfigured: true,
    },
    integrations: { rss: 'unavailable', sleeper: true, github: false },
    metrics: { events: 12, failures: 1 },
    broadcasts: {
      categories: [
        {
          category: 'rss',
          label: 'RSS',
          state: 'enabled',
          destination: '#private-channel',
          quietHours: 'none',
          cadence: '1 hour',
          lastSuccessAt: '2026-08-23T19:55:00.000Z',
          health: 'degraded',
        },
      ],
      last7Days: [],
      last30Days: [],
    },
    ...overrides,
  };
}
