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
  release: { version: '1.5.0', environment: 'Production', commit: 'a585c3e' },
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
      eyebrow: 'Read-only configuration',
      title: 'Configuration posture',
      intro:
        'What is enabled, what is bounded, and what still requires local administration.',
      cards: cards(
        ['Feature flags', '4 enabled', 'Configured'],
        ['Destinations', '3 allowlisted', 'Bounded'],
        ['Data retention', 'Policy active', 'Compliant'],
        ['Write controls', 'Unavailable here', 'Read-only'],
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
