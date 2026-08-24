import { describe, expect, it } from 'vitest';
import type { AdminConsoleSnapshot } from '../src/admin/admin-console.js';
import {
  createCommandDeckReadBoundary,
  projectCommandDeckMutationCatalog,
  projectCommandDeckReadSnapshot,
  type CommandDeckReadAuditEvent,
  type CommandDeckReadRequest,
} from '../src/admin/command-deck-read-api.js';

const observedAt = new Date('2026-08-23T20:00:00.000Z');

describe('Command Deck read projection', () => {
  it('projects a bounded mutation catalog without unsafe target values', () => {
    const credentialCanary = 'catalog-secret-canary';
    const projection = projectCommandDeckMutationCatalog({
      broadcastCategories: ['rss', 'invalid category', 'rss'],
      featureFlags: ['trivia', 'invalid flag', 'trivia'],
      rssHosts: ['feeds.example.test', 'not a host', 'feeds.example.test'],
      rssFeeds: [
        {
          url: `https://feeds.example.test/private/${credentialCanary}/crew.xml?access_token=${credentialCanary}`,
          label: 'Crew feed',
        },
        { url: 'https://evil.example.test/crew.xml', label: 'Wrong host' },
        {
          url: 'https://user:password@feeds.example.test/feed.xml',
          label: 'Unsafe',
        },
      ],
    });

    expect(projection).toEqual({
      schemaVersion: '1.0',
      actions: {
        broadcastCategories: ['rss'],
        featureFlags: ['trivia'],
        rssHosts: ['feeds.example.test'],
        rssFeeds: [
          {
            id: expect.stringMatching(/^rss_[a-f0-9]{32}$/),
            label: 'Crew feed',
          },
        ],
      },
    });
    expect(JSON.stringify(projection)).not.toContain(credentialCanary);
    expect(JSON.stringify(projection)).not.toContain('access_token');
  });

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
    expect(result.metrics).toMatchObject({
      events: 1_000_000_000,
      failures: 0,
    });
  });
});

describe('Command Deck read request boundary', () => {
  const now = new Date('2026-08-23T20:00:00.000Z');
  const token = 'read-only-token-with-enough-entropy';
  const validRequest = (
    overrides: Partial<CommandDeckReadRequest> = {},
  ): CommandDeckReadRequest => ({
    authorization: `Bearer ${token}`,
    origin: 'https://muthaship-command-deck.example.test',
    requestId: 'c248ad5f-1b62-4ed0-8caa-ab516cf9ea19',
    timestamp: now.toISOString(),
    remoteAddress: '10.0.0.4',
    ...overrides,
  });

  it.each([
    [
      'loopback without an origin',
      { origin: undefined, remoteAddress: '127.0.0.1' },
    ],
    ['an explicitly allowed HTTPS origin', {}],
  ])('accepts %s', (_label, overrides) => {
    const boundary = createBoundary();
    expect(boundary.authorize(validRequest(overrides), now)).toEqual({
      ok: true,
    });
  });

  it.each([
    ['missing token', { authorization: undefined }, 401, 'unauthorized'],
    ['wrong token', { authorization: 'Bearer wrong' }, 401, 'unauthorized'],
    [
      'malformed request ID',
      { requestId: 'not-a-uuid' },
      400,
      'invalid_request',
    ],
    [
      'malformed timestamp',
      { timestamp: 'not-a-date' },
      400,
      'invalid_request',
    ],
    [
      'date-only timestamp',
      { timestamp: '2026-08-23' },
      400,
      'invalid_request',
    ],
    [
      'non-canonical timestamp',
      { timestamp: '2026-08-23 20:00:00Z' },
      400,
      'invalid_request',
    ],
    [
      'expired timestamp',
      { timestamp: '2026-08-23T19:58:59.000Z' },
      401,
      'expired_request',
    ],
    [
      'future timestamp',
      { timestamp: '2026-08-23T20:01:01.000Z' },
      401,
      'expired_request',
    ],
    [
      'cross origin request',
      { origin: 'https://evil.example', remoteAddress: '10.0.0.5' },
      403,
      'origin_denied',
    ],
    [
      'remote request without origin',
      { origin: undefined, remoteAddress: '10.0.0.5' },
      403,
      'origin_denied',
    ],
  ] as const)('rejects %s', (_label, overrides, status, code) => {
    const boundary = createBoundary();
    expect(boundary.authorize(validRequest(overrides), now)).toEqual({
      ok: false,
      status,
      code,
    });
  });

  it('rejects a replayed request ID and allows it only after retention expires', () => {
    const boundary = createBoundary();
    expect(boundary.authorize(validRequest(), now)).toEqual({ ok: true });
    expect(boundary.authorize(validRequest(), now)).toEqual({
      ok: false,
      status: 401,
      code: 'replayed_request',
    });
    const later = new Date(now.getTime() + 61_000);
    expect(
      boundary.authorize(
        validRequest({ timestamp: later.toISOString() }),
        later,
      ),
    ).toEqual({ ok: true });
  });

  it('applies a fixed-window rate limit after authentication', () => {
    const boundary = createBoundary({ rateLimit: 2 });
    expect(boundary.authorize(validRequest(), now)).toEqual({ ok: true });
    expect(
      boundary.authorize(
        validRequest({ requestId: '624a631d-d623-42f9-ab52-613757c994fe' }),
        now,
      ),
    ).toEqual({ ok: true });
    expect(
      boundary.authorize(
        validRequest({ requestId: '49526c45-163a-4624-864a-04214d9c6930' }),
        now,
      ),
    ).toEqual({ ok: false, status: 429, code: 'rate_limited' });
  });

  it('emits metadata-only audit events without tokens or addresses', () => {
    const events: CommandDeckReadAuditEvent[] = [];
    const boundary = createBoundary({ audit: (event) => events.push(event) });
    boundary.authorize(validRequest(), now);
    boundary.authorize(
      validRequest({
        authorization: 'Bearer secret-canary',
        requestId: '165a7c33-7666-4661-84a1-8632125a4504',
        remoteAddress: '192.0.2.44',
      }),
      now,
    );

    expect(events).toEqual([
      {
        outcome: 'authorized',
        requestId: 'c248ad5f-1b62-4ed0-8caa-ab516cf9ea19',
        originClass: 'allowed_remote',
        observedAt: now.toISOString(),
      },
      {
        outcome: 'unauthorized',
        requestId: '165a7c33-7666-4661-84a1-8632125a4504',
        originClass: 'allowed_remote',
        observedAt: now.toISOString(),
      },
    ]);
    expect(JSON.stringify(events)).not.toMatch(/secret-canary|192\.0\.2\.44/);
  });

  function createBoundary(
    overrides: Partial<
      Parameters<typeof createCommandDeckReadBoundary>[0]
    > = {},
  ) {
    return createCommandDeckReadBoundary({
      token,
      allowedOrigins: ['https://muthaship-command-deck.example.test'],
      maxClockSkewMs: 60_000,
      replayRetentionMs: 60_000,
      rateLimit: 30,
      rateWindowMs: 60_000,
      ...overrides,
    });
  }
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
