export type ServiceState = 'healthy' | 'degraded' | 'stale' | 'unavailable';
export type ResilientViewState =
  'loading' | 'empty' | 'unavailable' | 'unauthorized';
export type ReadOnlyArea =
  'Community' | 'Broadcasts' | 'Integrations' | 'Settings';

export type AreaProjection = {
  eyebrow: string;
  title: string;
  intro: string;
  cards: Array<{ name: string; metric: string; state: string }>;
};

export type CommandDeckSnapshot = {
  contractVersion: '1.0';
  generatedAt: string;
  release: { version: string; environment: string; commit: string };
  services: Array<{
    name: string;
    detail: string;
    state: ServiceState;
    metric: string;
  }>;
  activity: { events: number; failures: number; windowDays: number };
  areas: Record<ReadOnlyArea, AreaProjection>;
  operationStates: ResilientViewState[];
  timeline: Array<{
    event: string;
    source: string;
    outcome: 'success' | 'review';
  }>;
};

export type OverallSummary = {
  state: ServiceState;
  label: string;
  attentionCount: number;
};

export type OverviewCopy = {
  lead: string;
  follow: string;
};

const serviceStates = new Set<ServiceState>([
  'healthy',
  'degraded',
  'stale',
  'unavailable',
]);
const resilientViewStates = new Set<ResilientViewState>([
  'loading',
  'empty',
  'unavailable',
  'unauthorized',
]);
const readOnlyAreas: ReadOnlyArea[] = [
  'Community',
  'Broadcasts',
  'Integrations',
  'Settings',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const isNonNegativeNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const cards = (...values: Array<[string, string, string]>) =>
  values.map(([name, metric, state]) => ({ name, metric, state }));

export const commandDeckFixture: CommandDeckSnapshot = {
  contractVersion: '1.0',
  generatedAt: '2026-08-23T12:12:00-04:00',
  release: { version: '1.6.0', environment: 'Production', commit: 'sample' },
  services: [
    {
      name: 'Discord gateway',
      detail: 'Connected and receiving events',
      state: 'healthy',
      metric: '42 ms',
    },
    {
      name: 'Engagement engine',
      detail: 'Four community features enabled',
      state: 'healthy',
      metric: '4 active',
    },
    {
      name: 'RSS monitor',
      detail: 'Feed has not refreshed on schedule',
      state: 'stale',
      metric: '14 min old',
    },
    {
      name: 'Sleeper Fantasy',
      detail: 'Upstream endpoint did not answer',
      state: 'unavailable',
      metric: 'Retrying',
    },
  ],
  activity: { events: 128, failures: 0, windowDays: 7 },
  areas: {
    Community: {
      eyebrow: 'Engagement intelligence',
      title: 'Community pulse',
      intro:
        'A content-free view of participation trends across the MuthaShip.',
      cards: cards(
        ['Introductions', '12 this month', 'Healthy'],
        ['Suggestions', '4 open', 'Review queue'],
        ['Trivia', '68% participation', 'Trending up'],
        ['Events', '3 upcoming', 'Scheduler healthy'],
      ),
    },
    Broadcasts: {
      eyebrow: 'Transmission log',
      title: 'Broadcast history',
      intro:
        'Safe delivery receipts and destinations. Message bodies remain where they belong: out of this deck.',
      cards: cards(
        ['Latest delivery', 'Test channel', 'Delivered'],
        ['Scheduled posts', '2 queued', 'Ready'],
        ['Failed deliveries', '0 this week', 'Clear'],
        ['Allowed channels', '3 configured', 'Bounded'],
      ),
    },
    Integrations: {
      eyebrow: 'Connected services',
      title: 'Connected systems',
      intro:
        'Readiness, freshness, and safe operational detail for every external integration.',
      cards: cards(
        ['Discord', 'Gateway online', 'Operational'],
        ['Sleeper Fantasy', 'Endpoint unavailable', 'Retrying'],
        ['Xbox RSS', 'Feed delayed', 'Stale'],
        ['SQLite', 'Local store healthy', 'Operational'],
      ),
    },
    Settings: {
      eyebrow: 'Protected configuration',
      title: 'Configuration posture',
      intro:
        'What is enabled, what is bounded, and what still requires local administration.',
      cards: cards(
        ['Feature flags', '4 enabled', 'Configured'],
        ['Destinations', '3 allowlisted', 'Bounded'],
        ['Data retention', 'Policy active', 'Compliant'],
        ['Write controls', 'Locked until access code', 'Protected'],
      ),
    },
  },
  operationStates: ['loading', 'empty', 'unavailable', 'unauthorized'],
  timeline: [
    {
      event: 'Scheduler completed',
      source: 'Engagement engine',
      outcome: 'success',
    },
    { event: 'RSS freshness warning', source: 'Xbox Wire', outcome: 'review' },
    { event: 'Snapshot published', source: 'Command Deck', outcome: 'success' },
  ],
};

export function validateCommandDeckSnapshot(
  value: unknown,
): CommandDeckSnapshot {
  if (!isRecord(value)) throw new Error('Snapshot is required.');
  const snapshot = value;
  if (snapshot.contractVersion !== '1.0')
    throw new Error('Unsupported contract version.');
  if (
    !isNonEmptyString(snapshot.generatedAt) ||
    !Number.isFinite(Date.parse(snapshot.generatedAt))
  )
    throw new Error('Snapshot generatedAt must be a valid timestamp.');

  if (!isRecord(snapshot.release)) throw new Error('Release is incomplete.');
  for (const field of ['version', 'environment', 'commit']) {
    if (!isNonEmptyString(snapshot.release[field]))
      throw new Error(`Release ${field} is required.`);
  }

  if (!Array.isArray(snapshot.services))
    throw new Error('Services are required.');
  for (const service of snapshot.services) {
    if (!isRecord(service)) throw new Error('Service entry is invalid.');
    if (!serviceStates.has(service.state as ServiceState))
      throw new Error('Service state is invalid.');
    for (const field of ['name', 'detail', 'metric']) {
      if (!isNonEmptyString(service[field]))
        throw new Error(`Service ${field} is required.`);
    }
  }

  if (!isRecord(snapshot.activity)) throw new Error('Activity is required.');
  if (
    !isNonNegativeNumber(snapshot.activity.events) ||
    !isNonNegativeNumber(snapshot.activity.failures) ||
    !isNonNegativeNumber(snapshot.activity.windowDays) ||
    snapshot.activity.windowDays === 0
  )
    throw new Error('Activity metrics are invalid.');

  if (!isRecord(snapshot.areas)) throw new Error('Areas are required.');
  for (const areaName of readOnlyAreas) {
    const area = snapshot.areas[areaName];
    if (!isRecord(area) || !Array.isArray(area.cards))
      throw new Error(`${areaName} area is incomplete.`);
    for (const field of ['eyebrow', 'title', 'intro']) {
      if (!isNonEmptyString(area[field]))
        throw new Error(`${areaName} ${field} is required.`);
    }
    for (const card of area.cards) {
      if (!isRecord(card)) throw new Error(`${areaName} card is invalid.`);
      for (const field of ['name', 'metric', 'state']) {
        if (!isNonEmptyString(card[field]))
          throw new Error(`${areaName} card ${field} is required.`);
      }
    }
  }

  if (!Array.isArray(snapshot.operationStates))
    throw new Error('Operation states are required.');
  for (const state of snapshot.operationStates) {
    if (!resilientViewStates.has(state as ResilientViewState))
      throw new Error('Operation state is invalid.');
  }

  if (!Array.isArray(snapshot.timeline))
    throw new Error('Timeline is required.');
  for (const event of snapshot.timeline) {
    if (!isRecord(event)) throw new Error('Timeline event is invalid.');
    if (!isNonEmptyString(event.event) || !isNonEmptyString(event.source))
      throw new Error('Timeline event is incomplete.');
    if (event.outcome !== 'success' && event.outcome !== 'review')
      throw new Error('Timeline outcome is invalid.');
  }

  return snapshot as CommandDeckSnapshot;
}

export function getCommandDeckSnapshot(
  value: unknown = commandDeckFixture,
): CommandDeckSnapshot {
  return validateCommandDeckSnapshot(value);
}

export type CommandDeckPresentationSource = 'sample' | 'live' | 'unavailable';

export type CommandDeckLiveSnapshot = {
  schemaVersion: '1.0';
  observedAt: string;
  freshness: { state: 'fresh' | 'stale'; staleAfterSeconds: number };
  release: { version: string; environment: string };
  health: {
    state: 'healthy' | 'degraded' | 'unavailable';
    reason: string;
  };
  providers: Array<{ id: string; state: string; selected: boolean }>;
  integrations: Array<{ id: string; state: string }>;
  schedulers: Array<{
    id: string;
    state: string;
    health: string;
    lastSuccessAt?: string;
  }>;
  featureFlags: string[];
  metrics: { events: number; failures: number; windowDays: number } | null;
  audit: { state: string };
};

const liveHealthStates = new Set(['healthy', 'degraded', 'unavailable']);

export function validateCommandDeckLiveSnapshot(
  value: unknown,
): CommandDeckLiveSnapshot {
  if (!isRecord(value)) throw new Error('Live snapshot is required.');
  if (value.schemaVersion !== '1.0')
    throw new Error('Unsupported live contract version.');
  if (
    !isNonEmptyString(value.observedAt) ||
    !Number.isFinite(Date.parse(value.observedAt))
  )
    throw new Error('Live snapshot observedAt must be a valid timestamp.');
  if (!isRecord(value.release)) throw new Error('Live release is incomplete.');
  if (
    !isNonEmptyString(value.release.version) ||
    !isNonEmptyString(value.release.environment)
  )
    throw new Error('Live release identity is incomplete.');
  if (!isRecord(value.health)) throw new Error('Live health is incomplete.');
  if (!liveHealthStates.has(String(value.health.state)))
    throw new Error('Live health state is invalid.');
  if (!isNonEmptyString(value.health.reason))
    throw new Error('Live health reason is required.');
  if (!Array.isArray(value.providers) || !Array.isArray(value.integrations))
    throw new Error('Live providers and integrations are required.');
  if (!Array.isArray(value.schedulers) || !Array.isArray(value.featureFlags))
    throw new Error('Live schedulers and feature flags are required.');
  if (value.metrics !== null && !isRecord(value.metrics))
    throw new Error('Live metrics are invalid.');
  if (!isRecord(value.audit) || !isNonEmptyString(value.audit.state))
    throw new Error('Live audit state is required.');
  return value as CommandDeckLiveSnapshot;
}

const serviceStateFromLive = (state: string): ServiceState => {
  if (state === 'healthy' || state === 'configured' || state === 'enabled')
    return 'healthy';
  if (state === 'stale' || state === 'paused' || state === 'degraded')
    return 'degraded';
  return 'unavailable';
};

export const unavailableCommandDeckSnapshot: CommandDeckSnapshot =
  validateCommandDeckSnapshot({
    ...commandDeckFixture,
    generatedAt: '1970-01-01T00:00:00.000Z',
    release: {
      version: 'unknown',
      environment: 'unavailable',
      commit: 'unknown',
    },
    services: commandDeckFixture.services.map((service) => ({
      ...service,
      detail: 'Jarvis snapshot is unavailable. Use the local fallback.',
      state: 'unavailable',
      metric: 'Offline',
    })),
    activity: { events: 0, failures: 0, windowDays: 7 },
    timeline: [
      {
        event: 'Live snapshot unavailable',
        source: 'Command Deck',
        outcome: 'review',
      },
    ],
  });

export function presentCommandDeckReadSnapshot(
  value: unknown,
): CommandDeckSnapshot {
  const live = validateCommandDeckLiveSnapshot(value);
  const selectedProvider =
    live.providers.find((provider) => provider.selected)?.id ?? 'none';
  const metrics = live.metrics ?? { events: 0, failures: 0, windowDays: 7 };
  const featureCount = live.featureFlags.length;
  const schedulerCards = live.schedulers
    .slice(0, 4)
    .map((scheduler) => [
      scheduler.id,
      scheduler.state,
      scheduler.health === 'healthy' ? 'Healthy' : 'Attention',
    ]) as Array<[string, string, string]>;
  return validateCommandDeckSnapshot({
    contractVersion: '1.0',
    generatedAt: live.observedAt,
    release: {
      version: live.release.version,
      environment: live.release.environment,
      commit: 'live',
    },
    services: [
      {
        name: 'Platform health',
        detail: live.health.reason.split('_').join(' '),
        state: live.health.state,
        metric: live.health.state,
      },
      {
        name: 'Selected provider',
        detail: `${selectedProvider} is the active answer path`,
        state: serviceStateFromLive(
          live.providers.find((provider) => provider.selected)?.state ??
            'unavailable',
        ),
        metric: selectedProvider,
      },
      ...live.integrations.map((integration) => ({
        name: integration.id,
        detail: `${integration.id} is ${integration.state}`,
        state: serviceStateFromLive(integration.state),
        metric: integration.state,
      })),
    ],
    activity: {
      events: metrics.events,
      failures: metrics.failures,
      windowDays: metrics.windowDays === 0 ? 7 : metrics.windowDays,
    },
    areas: {
      Community: {
        eyebrow: 'Engagement intelligence',
        title: 'Community pulse',
        intro:
          'A content-free view of enabled community features across the MuthaShip.',
        cards: cards(
          ['Enabled features', `${featureCount} active`, 'Configured'],
          ['Audit', live.audit.state, 'Protected'],
          [
            'Platform',
            live.health.state,
            live.health.state === 'healthy' ? 'Healthy' : 'Attention',
          ],
          ['Metrics window', `${metrics.windowDays}-day`, 'Bounded'],
        ),
      },
      Broadcasts: {
        eyebrow: 'Transmission log',
        title: 'Broadcast history',
        intro:
          'Safe scheduler receipts and destinations. Message bodies remain out of this deck.',
        cards: cards(
          ...(schedulerCards.length > 0
            ? schedulerCards
            : ([['Schedulers', 'None configured', 'Empty']] as Array<
                [string, string, string]
              >)),
        ),
      },
      Integrations: {
        eyebrow: 'Connected services',
        title: 'Connected systems',
        intro:
          'Readiness and safe operational detail for every external integration.',
        cards: cards(
          ...live.integrations.map(
            (integration) =>
              [
                integration.id,
                integration.state,
                integration.state === 'configured' ? 'Operational' : 'Review',
              ] as [string, string, string],
          ),
        ),
      },
      Settings: {
        eyebrow: 'Protected configuration',
        title: 'Configuration posture',
        intro:
          'What is enabled, what is bounded, and what still requires a write access code.',
        cards: cards(
          ['Feature flags', `${featureCount} enabled`, 'Configured'],
          ['Write controls', 'Locked until access code', 'Protected'],
          ['Audit', live.audit.state, 'Ready'],
          ['Local fallback', '127.0.0.1:8787', 'Available'],
        ),
      },
    },
    operationStates: ['loading', 'empty', 'unavailable', 'unauthorized'],
    timeline:
      live.schedulers.length === 0
        ? [
            {
              event: 'Snapshot published',
              source: 'Command Deck',
              outcome: 'success' as const,
            },
          ]
        : live.schedulers.slice(0, 5).map((scheduler) => ({
            event: `${scheduler.id} ${scheduler.state}`,
            source: scheduler.id,
            outcome:
              scheduler.health === 'healthy'
                ? ('success' as const)
                : ('review' as const),
          })),
  });
}

export function getSnapshotFreshness(
  snapshot: CommandDeckSnapshot,
  now = new Date(),
) {
  const ageMinutes = Math.max(
    0,
    Math.floor(
      (now.getTime() - new Date(snapshot.generatedAt).getTime()) / 60_000,
    ),
  );
  return {
    ageMinutes,
    state: ageMinutes > 10 ? ('stale' as const) : ('fresh' as const),
  };
}

export function getOverallSummary(
  snapshot: CommandDeckSnapshot,
): OverallSummary {
  const attentionCount = snapshot.services.filter(
    ({ state }) => state !== 'healthy',
  ).length;
  if (snapshot.services.some(({ state }) => state === 'unavailable'))
    return {
      state: 'unavailable',
      label: 'Service disruption',
      attentionCount,
    };
  if (
    snapshot.services.some(
      ({ state }) => state === 'degraded' || state === 'stale',
    )
  )
    return { state: 'degraded', label: 'Attention needed', attentionCount };
  return { state: 'healthy', label: 'Operational', attentionCount };
}

export function getOverviewCopy(state: ServiceState): OverviewCopy {
  if (state === 'unavailable')
    return {
      lead: 'A system is offline.',
      follow: 'The deck has the receipts.',
    };
  if (state === 'degraded' || state === 'stale')
    return { lead: 'The ship is moving.', follow: 'A system needs eyes.' };
  return { lead: 'The ship is steady.', follow: 'All systems are nominal.' };
}

export type CommandDeckMutationAction =
  | {
      type: 'broadcast_state';
      category: string;
      state: 'enabled' | 'paused';
    }
  | { type: 'feature_flag'; feature: string; enabled: boolean }
  | {
      type: 'rss_feed';
      operation: 'add';
      url: string;
      label: string;
    }
  | { type: 'rss_feed'; operation: 'remove'; feedId: string };

export type CommandDeckMutationCatalog = {
  broadcastCategories: string[];
  featureFlags: string[];
  rssHosts: string[];
  rssFeeds: Array<{ id: string; label: string }>;
};

export type CommandDeckPreview = {
  id: string;
  expiresAt: string;
  target: string;
  diff: { before: unknown; after: unknown };
};

export type CommandDeckReceipt = {
  id: string;
  confirmedAt: string;
  target: string;
  rollbackToken?: string;
};

export type CommandDeckApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; code: string; message: string };

const commandDeckConfigPath = '/api/v1/command-deck/config';

export function resolveCommandDeckApiBaseUrl(
  value: unknown,
): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  try {
    const url = new URL(value);
    const loopback = ['127.0.0.1', '::1', 'localhost'].includes(url.hostname);
    if (
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== '' ||
      url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    )
      return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

const createRequestId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    return crypto.randomUUID();
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.getRandomValues === 'function'
  ) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return [...bytes]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
  }
  throw new Error('This browser cannot create a safe Command Deck request ID.');
};

const errorResult = (
  status: number,
  body: unknown,
): CommandDeckApiResult<never> => {
  const error =
    body !== null && typeof body === 'object' && 'error' in body
      ? (body as { error?: { code?: unknown; message?: unknown } }).error
      : undefined;
  return {
    ok: false,
    status,
    code: typeof error?.code === 'string' ? error.code : 'unavailable',
    message:
      typeof error?.message === 'string'
        ? error.message
        : 'Command Deck did not return a safe result.',
  };
};

async function commandDeckRequest<T>(
  apiBaseUrl: string | undefined,
  token: string,
  path: string,
  options: { method: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string },
): Promise<CommandDeckApiResult<T>> {
  if (apiBaseUrl === undefined)
    return {
      ok: false,
      status: 400,
      code: 'invalid_api_base',
      message:
        'Safe controls are unavailable until a valid API address is configured.',
    };
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${commandDeckConfigPath}${path}`, {
      method: options.method,
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Command-Deck-Request-Id': createRequestId(),
        'X-Command-Deck-Timestamp': new Date().toISOString(),
        ...(options.body === undefined
          ? {}
          : { 'Content-Type': 'application/json' }),
        ...(options.idempotencyKey === undefined
          ? {}
          : { 'Idempotency-Key': options.idempotencyKey }),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
  } catch {
    return {
      ok: false,
      status: 503,
      code: 'unavailable',
      message:
        'Jarvis outcome is unknown. Reconcile with the same confirmation before creating another change.',
    };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      ok: false,
      status: response.status,
      code: 'invalid_response',
      message:
        'Jarvis outcome is unknown. Reconcile with the same confirmation before creating another change.',
    };
  }
  return response.ok
    ? { ok: true, value: body as T }
    : errorResult(response.status, body);
}

export async function getCommandDeckMutationCatalog(
  apiBaseUrl: string | undefined,
  token: string,
): Promise<CommandDeckApiResult<CommandDeckMutationCatalog>> {
  const result = await commandDeckRequest<{
    actions?: CommandDeckMutationCatalog;
  }>(apiBaseUrl, token, '/catalog', { method: 'GET' });
  if (!result.ok) return result;
  const actions = result.value.actions;
  if (
    actions === undefined ||
    !Array.isArray(actions.broadcastCategories) ||
    !Array.isArray(actions.featureFlags) ||
    !Array.isArray(actions.rssHosts) ||
    !Array.isArray(actions.rssFeeds)
  )
    return {
      ok: false,
      status: 502,
      code: 'invalid_response',
      message: 'Jarvis returned an invalid safe-control catalog.',
    };
  return { ok: true, value: actions };
}

export async function previewCommandDeckMutation(
  apiBaseUrl: string | undefined,
  token: string,
  action: CommandDeckMutationAction,
): Promise<CommandDeckApiResult<CommandDeckPreview>> {
  const result = await commandDeckRequest<{ preview?: CommandDeckPreview }>(
    apiBaseUrl,
    token,
    '/preview',
    { method: 'POST', body: { action } },
  );
  return result.ok && result.value.preview !== undefined
    ? { ok: true, value: result.value.preview }
    : result.ok
      ? {
          ok: false,
          status: 502,
          code: 'invalid_response',
          message: 'Jarvis did not provide a preview. No change was sent.',
        }
      : result;
}

export async function cancelCommandDeckPreview(
  apiBaseUrl: string | undefined,
  token: string,
  previewId: string,
): Promise<CommandDeckApiResult<undefined>> {
  const result = await commandDeckRequest<{ cancelled?: boolean }>(
    apiBaseUrl,
    token,
    '/cancel',
    { method: 'POST', body: { previewId } },
  );
  return result.ok && result.value.cancelled === true
    ? { ok: true, value: undefined }
    : result.ok
      ? {
          ok: false,
          status: 502,
          code: 'invalid_response',
          message: 'Jarvis did not confirm cancellation.',
        }
      : result;
}

export async function confirmCommandDeckMutation(
  apiBaseUrl: string | undefined,
  token: string,
  previewId: string,
  action: CommandDeckMutationAction | undefined,
  idempotencyKey: string,
  rollback = false,
): Promise<CommandDeckApiResult<CommandDeckReceipt>> {
  const result = await commandDeckRequest<{ receipt?: CommandDeckReceipt }>(
    apiBaseUrl,
    token,
    rollback ? '/rollback' : '/confirm',
    {
      method: 'POST',
      body: rollback ? { previewId } : { previewId, action },
      idempotencyKey,
    },
  );
  return result.ok && result.value.receipt !== undefined
    ? { ok: true, value: result.value.receipt }
    : result.ok
      ? {
          ok: false,
          status: 502,
          code: 'invalid_response',
          message:
            'Jarvis outcome is unknown. Reconcile with the same confirmation before creating another change.',
        }
      : result;
}

export async function previewCommandDeckRollback(
  apiBaseUrl: string | undefined,
  token: string,
  rollbackToken: string,
): Promise<CommandDeckApiResult<CommandDeckPreview>> {
  const result = await commandDeckRequest<{ preview?: CommandDeckPreview }>(
    apiBaseUrl,
    token,
    '/rollback',
    { method: 'POST', body: { rollbackToken } },
  );
  return result.ok && result.value.preview !== undefined
    ? { ok: true, value: result.value.preview }
    : result.ok
      ? {
          ok: false,
          status: 502,
          code: 'invalid_response',
          message: 'Jarvis did not provide a rollback preview.',
        }
      : result;
}

export const createCommandDeckIdempotencyKey = createRequestId;
