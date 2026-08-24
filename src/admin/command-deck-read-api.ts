import { createHash, timingSafeEqual } from 'node:crypto';
import type { AdminConsoleSnapshot } from './admin-console.js';
import { commandDeckRssFeedId } from './command-deck-rss-feed.js';

export interface CommandDeckMutationCatalog {
  readonly broadcastCategories: readonly string[];
  readonly featureFlags: readonly string[];
  readonly rssHosts: readonly string[];
  readonly rssFeeds?: readonly {
    readonly url: string;
    readonly label: string;
  }[];
}

export interface CommandDeckMutationCatalogResponse {
  readonly schemaVersion: '1.0';
  readonly actions: {
    readonly broadcastCategories: readonly string[];
    readonly featureFlags: readonly string[];
    readonly rssHosts: readonly string[];
    readonly rssFeeds: readonly {
      readonly id: string;
      readonly label: string;
    }[];
  };
}

export function projectCommandDeckMutationCatalog(
  catalog: CommandDeckMutationCatalog,
): CommandDeckMutationCatalogResponse {
  return {
    schemaVersion: '1.0',
    actions: {
      broadcastCategories: boundedCatalogValues(
        catalog.broadcastCategories,
        /^[a-z][a-z0-9_]{0,63}$/,
      ),
      featureFlags: boundedCatalogValues(
        catalog.featureFlags,
        /^[a-z][a-z0-9_]{0,63}$/,
      ),
      rssHosts: boundedCatalogValues(
        catalog.rssHosts,
        /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
      ),
      rssFeeds: (catalog.rssFeeds ?? [])
        .filter((feed) => isAllowedCatalogRssFeed(feed, catalog.rssHosts))
        .map((feed) => ({
          id: commandDeckRssFeedId(feed.url),
          label: feed.label.trim(),
        }))
        .slice(0, 50),
    },
  };
}

function isAllowedCatalogRssFeed(
  feed: { readonly url: string; readonly label: string },
  hosts: readonly string[],
): boolean {
  if (typeof feed.url !== 'string' || typeof feed.label !== 'string')
    return false;
  try {
    const url = new URL(feed.url);
    return (
      url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      hosts.includes(url.hostname) &&
      /^[^\r\n]{1,120}$/.test(feed.label.trim())
    );
  } catch {
    return false;
  }
}

export interface CommandDeckReadRequest {
  readonly authorization?: string | undefined;
  readonly origin?: string | undefined;
  readonly requestId?: string | undefined;
  readonly timestamp?: string | undefined;
  readonly remoteAddress?: string | undefined;
}

export type CommandDeckReadFailureCode =
  | 'invalid_request'
  | 'unauthorized'
  | 'expired_request'
  | 'replayed_request'
  | 'origin_denied'
  | 'rate_limited';

export type CommandDeckReadAuthorization =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly status: 400 | 401 | 403 | 429;
      readonly code: CommandDeckReadFailureCode;
    };

export interface CommandDeckReadAuditEvent {
  readonly outcome: 'authorized' | CommandDeckReadFailureCode;
  readonly requestId?: string;
  readonly originClass: 'loopback' | 'allowed_remote' | 'denied_remote';
  readonly observedAt: string;
}

export interface CommandDeckReadBoundaryPolicy {
  readonly token: string;
  readonly allowedOrigins: readonly string[];
  readonly maxClockSkewMs: number;
  readonly replayRetentionMs: number;
  readonly rateLimit: number;
  readonly rateWindowMs: number;
  readonly audit?: (event: CommandDeckReadAuditEvent) => void;
}

export function createCommandDeckReadBoundary(
  policy: CommandDeckReadBoundaryPolicy,
) {
  const replayCache = new Map<string, number>();
  let rateWindowStartedAt = 0;
  let acceptedInWindow = 0;

  return {
    authorize(
      request: CommandDeckReadRequest,
      now: Date,
    ): CommandDeckReadAuthorization {
      const nowMs = now.getTime();
      const originClass = classifyOrigin(request, policy.allowedOrigins);
      const finish = (
        result: CommandDeckReadAuthorization,
      ): CommandDeckReadAuthorization => {
        policy.audit?.({
          outcome: result.ok ? 'authorized' : result.code,
          ...(isUuid(request.requestId)
            ? { requestId: request.requestId }
            : {}),
          originClass,
          observedAt: now.toISOString(),
        });
        return result;
      };

      if (!isUuid(request.requestId) || !isIsoTimestamp(request.timestamp)) {
        return finish({ ok: false, status: 400, code: 'invalid_request' });
      }
      if (!matchesBearerToken(request.authorization, policy.token)) {
        return finish({ ok: false, status: 401, code: 'unauthorized' });
      }
      if (originClass === 'denied_remote') {
        return finish({ ok: false, status: 403, code: 'origin_denied' });
      }

      const requestedAt = Date.parse(request.timestamp);
      if (Math.abs(nowMs - requestedAt) > policy.maxClockSkewMs) {
        return finish({ ok: false, status: 401, code: 'expired_request' });
      }

      for (const [requestId, acceptedAt] of replayCache) {
        if (nowMs - acceptedAt > policy.replayRetentionMs) {
          replayCache.delete(requestId);
        }
      }
      if (replayCache.has(request.requestId)) {
        return finish({ ok: false, status: 401, code: 'replayed_request' });
      }

      if (
        rateWindowStartedAt === 0 ||
        nowMs - rateWindowStartedAt >= policy.rateWindowMs
      ) {
        rateWindowStartedAt = nowMs;
        acceptedInWindow = 0;
      }
      if (acceptedInWindow >= policy.rateLimit) {
        return finish({ ok: false, status: 429, code: 'rate_limited' });
      }

      acceptedInWindow += 1;
      replayCache.set(request.requestId, nowMs);
      return finish({ ok: true });
    },
  };
}

export type CommandDeckReadState = 'healthy' | 'degraded' | 'unavailable';
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
        category.health === 'ready' ? ('healthy' as const) : category.health,
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

function boundedCatalogValues(
  values: readonly string[],
  pattern: RegExp,
): readonly string[] {
  return [...new Set(values.filter((value) => pattern.test(value)))].slice(
    0,
    50,
  );
}

function boundedLabel(value: string, fallback: string): string {
  const normalized = value.trim();
  return /^[a-zA-Z0-9._ -]{1,64}$/.test(normalized) ? normalized : fallback;
}

function isIsoTimestamp(value: string | undefined): value is string {
  return (
    value !== undefined &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isUuid(value: string | undefined): value is string {
  return (
    value !== undefined &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function matchesBearerToken(
  authorization: string | undefined,
  expectedToken: string,
): boolean {
  const prefix = 'Bearer ';
  const suppliedToken = authorization?.startsWith(prefix)
    ? authorization.slice(prefix.length)
    : '';
  const supplied = createHash('sha256').update(suppliedToken).digest();
  const expected = createHash('sha256').update(expectedToken).digest();
  return timingSafeEqual(supplied, expected);
}

function classifyOrigin(
  request: CommandDeckReadRequest,
  allowedOrigins: readonly string[],
): CommandDeckReadAuditEvent['originClass'] {
  if (isLoopback(request.remoteAddress) && request.origin === undefined) {
    return 'loopback';
  }
  return request.origin !== undefined && allowedOrigins.includes(request.origin)
    ? 'allowed_remote'
    : 'denied_remote';
}

function isLoopback(address: string | undefined): boolean {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  );
}
