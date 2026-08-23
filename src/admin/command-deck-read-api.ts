import type { AdminConsoleSnapshot } from './admin-console.js';

export type CommandDeckReadState =
  | 'healthy'
  | 'degraded'
  | 'unavailable';
export type ConfigurationState = 'configured' | 'disabled';

export interface CommandDeckReadSnapshot {
  readonly schemaVersion: '1.0';
  readonly observedAt: string;
  readonly freshness: {
    readonly state: 'fresh';
    readonly staleAfterSeconds: 60;
  };
  readonly release: { readonly version: string; readonly environment: string };
  readonly health: {
    readonly state: CommandDeckReadState;
    readonly reason:
      | 'operational'
      | 'integration_attention'
      | 'operational_failures'
      | 'database_unavailable';
  };
  readonly providers: readonly {
    readonly id: 'openai' | 'ollama' | 'web_search';
    readonly state: ConfigurationState;
    readonly selected: boolean;
  }[];
  readonly integrations: readonly {
    readonly id: 'rss' | 'sleeper' | 'github';
    readonly state: ConfigurationState | 'unavailable';
  }[];
  readonly schedulers: readonly {
    readonly id: string;
    readonly state: 'enabled' | 'paused' | 'disabled';
    readonly health: CommandDeckReadState;
    readonly lastSuccessAt?: string;
  }[];
  readonly featureFlags: readonly string[];
  readonly metrics: {
    readonly events: number;
    readonly failures: number;
    readonly windowDays: 7;
  } | null;
  readonly audit: { readonly state: 'ready' };
}

const featureAllowlist = new Set([
  'introductions',
  'suggestions',
  'events',
  'trivia',
  'proactive',
  'recaps',
  'birthdays',
  'daily',
  'economy',
  'games',
  'intelligence',
  'image_generation',
  'rss',
  'sleeper',
]);

export function projectCommandDeckReadSnapshot(
  snapshot: AdminConsoleSnapshot,
  observedAt: Date,
): CommandDeckReadSnapshot {
  const schedulers = (snapshot.broadcasts?.categories ?? [])
    .slice(0, 25)
    .map((category) => ({
      id: category.category,
      state: category.state,
      health:
        category.health === 'ready'
          ? ('healthy' as const)
          : category.health,
      ...(isIsoTimestamp(category.lastSuccessAt)
        ? { lastSuccessAt: category.lastSuccessAt }
        : {}),
    }));
  const hasIntegrationAttention =
    snapshot.integrations.rss === 'unavailable' ||
    schedulers.some(({ health }) => health !== 'healthy');
  const failures = boundedCount(snapshot.metrics?.failures ?? 0);
  const health =
    snapshot.database === 'unavailable'
      ? ({
          state: 'unavailable',
          reason: 'database_unavailable',
        } as const)
      : hasIntegrationAttention
        ? ({
            state: 'degraded',
            reason: 'integration_attention',
          } as const)
        : failures > 0
          ? ({
              state: 'degraded',
              reason: 'operational_failures',
            } as const)
          : ({ state: 'healthy', reason: 'operational' } as const);
  const selectedProvider =
    snapshot.providers.ai === 'openai' || snapshot.providers.ai === 'ollama'
      ? snapshot.providers.ai
      : undefined;

  return {
    schemaVersion: '1.0',
    observedAt: observedAt.toISOString(),
    freshness: { state: 'fresh', staleAfterSeconds: 60 },
    release: {
      version: boundedLabel(snapshot.platform.version, 'unknown'),
      environment: boundedLabel(snapshot.platform.environment, 'unknown'),
    },
    health,
    providers: [
      {
        id: 'openai',
        state: snapshot.providers.openAiConfigured ? 'configured' : 'disabled',
        selected: selectedProvider === 'openai',
      },
      {
        id: 'ollama',
        state: snapshot.providers.ollamaConfigured ? 'configured' : 'disabled',
        selected: selectedProvider === 'ollama',
      },
      {
        id: 'web_search',
        state: snapshot.providers.webSearchConfigured
          ? 'configured'
          : 'disabled',
        selected: false,
      },
    ],
    integrations: [
      {
        id: 'rss',
        state:
          snapshot.integrations.rss === 'ready'
            ? 'configured'
            : snapshot.integrations.rss === 'unavailable'
              ? 'unavailable'
              : 'disabled',
      },
      {
        id: 'sleeper',
        state: snapshot.integrations.sleeper ? 'configured' : 'disabled',
      },
      {
        id: 'github',
        state: snapshot.integrations.github ? 'configured' : 'disabled',
      },
    ],
    schedulers,
    featureFlags: [
      ...new Set(
        snapshot.engagement.features.filter((feature) =>
          featureAllowlist.has(feature),
        ),
      ),
    ].slice(0, 50),
    metrics:
      snapshot.metrics === null
        ? null
        : {
            events: boundedCount(snapshot.metrics.events),
            failures,
            windowDays: 7,
          },
    audit: { state: 'ready' },
  };
}

function boundedCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1_000_000_000, Math.max(0, Math.floor(value)));
}

function boundedLabel(value: string, fallback: string): string {
  const normalized = value.trim();
  return /^[a-zA-Z0-9._ -]{1,64}$/.test(normalized) ? normalized : fallback;
}

function isIsoTimestamp(value: string | undefined): value is string {
  return value !== undefined && Number.isFinite(Date.parse(value));
}
