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
  if (!value || typeof value !== 'object')
    throw new Error('Snapshot is required.');
  const snapshot = value as Partial<CommandDeckSnapshot>;
  if (snapshot.contractVersion !== '1.0')
    throw new Error('Unsupported contract version.');
  const areas = snapshot.areas;
  if (
    !snapshot.release ||
    !Array.isArray(snapshot.services) ||
    !snapshot.activity ||
    !areas ||
    !['Community', 'Broadcasts', 'Integrations', 'Settings'].every((area) =>
      Array.isArray(areas[area as ReadOnlyArea]?.cards),
    ) ||
    !Array.isArray(snapshot.operationStates) ||
    !Array.isArray(snapshot.timeline)
  ) {
    throw new Error('Snapshot is incomplete.');
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
