import type {
  ProviderHealth,
  ProviderState,
  ReadOnlyProvider,
  SafeProviderHealth,
} from './provider-contract.js';

export type ProviderHealthFetcher = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

const withTimeout = async (
  fetcher: ProviderHealthFetcher,
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

const disabledHealth = (): ProviderHealth => ({
  state: 'disabled',
  detail: 'provider disabled',
});

const readyHealth = (): ProviderHealth => ({
  state: 'ready',
  detail: 'read-only API available',
});

const unavailableHealth = (): ProviderHealth => ({
  state: 'unavailable',
});

/**
 * Cheap runtime probes for published integrations.
 * Never includes tokens, query strings, payload bodies, or member content.
 */
export const createOllamaHealthProvider = (options: {
  readonly baseUrl: string;
  readonly enabled: boolean;
  readonly timeoutMs?: number;
  readonly fetch?: ProviderHealthFetcher;
}): ReadOnlyProvider => ({
  id: 'ollama',
  version: '1',
  health: async () => {
    if (!options.enabled || options.baseUrl.trim() === '') {
      return disabledHealth();
    }
    const fetcher = options.fetch ?? globalThis.fetch;
    try {
      const base = options.baseUrl.replace(/\/+$/, '');
      const response = await withTimeout(
        fetcher,
        `${base}/api/tags`,
        { method: 'GET' },
        options.timeoutMs ?? 3_000,
      );
      return response.ok ? readyHealth() : unavailableHealth();
    } catch {
      return unavailableHealth();
    }
  },
});

export const createOpenAIHealthProvider = (options: {
  readonly apiKey: string;
  readonly enabled: boolean;
  readonly timeoutMs?: number;
  readonly fetch?: ProviderHealthFetcher;
}): ReadOnlyProvider => ({
  id: 'openai',
  version: '1',
  health: async () => {
    if (!options.enabled || options.apiKey.trim() === '') {
      return disabledHealth();
    }
    const fetcher = options.fetch ?? globalThis.fetch;
    try {
      const response = await withTimeout(
        fetcher,
        'https://api.openai.com/v1/models',
        {
          method: 'GET',
          headers: {
            authorization: `Bearer ${options.apiKey}`,
          },
        },
        options.timeoutMs ?? 5_000,
      );
      return response.ok ? readyHealth() : unavailableHealth();
    } catch {
      return unavailableHealth();
    }
  },
});

export const createWebSearchHealthProvider = (options: {
  readonly apiKey: string;
  readonly enabled: boolean;
  readonly timeoutMs?: number;
  readonly fetch?: ProviderHealthFetcher;
}): ReadOnlyProvider => ({
  id: 'web-search',
  version: '1',
  health: async () => {
    if (!options.enabled || options.apiKey.trim() === '') {
      return disabledHealth();
    }
    const fetcher = options.fetch ?? globalThis.fetch;
    try {
      // Minimal authenticated request; result content is discarded.
      const response = await withTimeout(
        fetcher,
        'https://api.tavily.com/search',
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${options.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            query: 'health-check',
            search_depth: 'basic',
            max_results: 1,
            include_answer: false,
            include_raw_content: false,
            include_images: false,
          }),
        },
        options.timeoutMs ?? 5_000,
      );
      return response.ok ? readyHealth() : unavailableHealth();
    } catch {
      return unavailableHealth();
    }
  },
});

export const createRssHealthProvider = (options: {
  readonly configured: boolean;
  readonly runtimeAvailable: boolean;
}): ReadOnlyProvider => ({
  id: 'rss',
  version: '1',
  health: async () => {
    if (!options.configured) return disabledHealth();
    return options.runtimeAvailable ? readyHealth() : unavailableHealth();
  },
});

export const createSleeperHealthProvider = (options: {
  readonly leagueId: string;
  readonly enabled: boolean;
  readonly timeoutMs?: number;
  readonly fetch?: ProviderHealthFetcher;
}): ReadOnlyProvider => ({
  id: 'sleeper',
  version: '1',
  health: async () => {
    if (!options.enabled || !/^\d{8,20}$/.test(options.leagueId.trim())) {
      return disabledHealth();
    }
    const fetcher = options.fetch ?? globalThis.fetch;
    try {
      const response = await withTimeout(
        fetcher,
        `https://api.sleeper.app/v1/league/${encodeURIComponent(options.leagueId.trim())}`,
        { method: 'GET' },
        options.timeoutMs ?? 5_000,
      );
      return response.ok ? readyHealth() : unavailableHealth();
    } catch {
      return unavailableHealth();
    }
  },
});

export const createGitHubHealthProvider = (options: {
  readonly owner: string;
  readonly repo: string;
  readonly token?: string;
  readonly enabled: boolean;
  readonly timeoutMs?: number;
  readonly fetch?: ProviderHealthFetcher;
}): ReadOnlyProvider => ({
  id: 'github',
  version: '1',
  health: async () => {
    if (
      !options.enabled ||
      options.owner.trim() === '' ||
      options.repo.trim() === ''
    ) {
      return disabledHealth();
    }
    const fetcher = options.fetch ?? globalThis.fetch;
    try {
      const response = await withTimeout(
        fetcher,
        `https://api.github.com/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}`,
        {
          method: 'GET',
          headers: {
            accept: 'application/vnd.github+json',
            'user-agent': 'Jarvis-Discord-Bot',
            ...(options.token?.trim()
              ? { authorization: `Bearer ${options.token}` }
              : {}),
          },
        },
        options.timeoutMs ?? 5_000,
      );
      return response.ok ? readyHealth() : unavailableHealth();
    } catch {
      return unavailableHealth();
    }
  },
});

export const stateFor = (
  snapshots: readonly SafeProviderHealth[],
  id: string,
): ProviderState =>
  snapshots.find((snapshot) => snapshot.id === id)?.state ?? 'disabled';

export const formatProviderState = (state: ProviderState): string => {
  if (state === 'ready') return 'ready';
  if (state === 'unavailable') return 'unavailable';
  return 'disabled';
};
