import { describe, expect, it } from 'vitest';
import {
  createGitHubHealthProvider,
  createOllamaHealthProvider,
  createOpenAIHealthProvider,
  createRssHealthProvider,
  createSleeperHealthProvider,
  createWebSearchHealthProvider,
  stateFor,
} from '../src/providers/provider-health.js';
import {
  ProviderRegistry,
  type ProviderState,
  type SafeProviderHealth,
} from '../src/providers/provider-contract.js';

type FakeResponse = {
  readonly ok: boolean;
  readonly status?: number;
};

const sequenceFetcher = (responses: readonly FakeResponse[]) => {
  let index = 0;
  return async (): Promise<Response> => {
    const next = responses[Math.min(index, responses.length - 1)]!;
    index += 1;
    return {
      ok: next.ok,
      status: next.status ?? (next.ok ? 200 : 503),
    } as Response;
  };
};

const expectStates = (
  snapshots: readonly SafeProviderHealth[],
  expected: Readonly<Record<string, ProviderState>>,
): void => {
  for (const [id, state] of Object.entries(expected)) {
    expect(stateFor(snapshots, id)).toBe(state);
  }
};

describe('provider published availability and recovery state (#289)', () => {
  it('publishes unavailable → recovered → unavailable for every probed integration', async () => {
    const cases = [
      {
        id: 'ollama',
        create: (
          fetch: (input: string, init?: RequestInit) => Promise<Response>,
        ) =>
          createOllamaHealthProvider({
            baseUrl: 'http://127.0.0.1:11434',
            enabled: true,
            fetch,
          }),
      },
      {
        id: 'openai',
        create: (
          fetch: (input: string, init?: RequestInit) => Promise<Response>,
        ) =>
          createOpenAIHealthProvider({
            apiKey: 'test-key',
            enabled: true,
            fetch,
          }),
      },
      {
        id: 'web-search',
        create: (
          fetch: (input: string, init?: RequestInit) => Promise<Response>,
        ) =>
          createWebSearchHealthProvider({
            apiKey: 'test-key',
            enabled: true,
            fetch,
          }),
      },
      {
        id: 'sleeper',
        create: (
          fetch: (input: string, init?: RequestInit) => Promise<Response>,
        ) =>
          createSleeperHealthProvider({
            leagueId: '1234567890',
            enabled: true,
            fetch,
          }),
      },
      {
        id: 'github',
        create: (
          fetch: (input: string, init?: RequestInit) => Promise<Response>,
        ) =>
          createGitHubHealthProvider({
            owner: 'tjhiggy',
            repo: 'Jarvis',
            enabled: true,
            fetch,
          }),
      },
    ] as const;

    for (const providerCase of cases) {
      const fetch = sequenceFetcher([
        { ok: false },
        { ok: true },
        { ok: false },
      ]);
      const provider = providerCase.create(fetch);
      const registry = new ProviderRegistry([provider]);

      const first = await registry.health();
      expectStates(first, { [providerCase.id]: 'unavailable' });
      expect(first[0]).toEqual({
        id: providerCase.id,
        version: '1',
        state: 'unavailable',
      });

      const second = await registry.health();
      expectStates(second, { [providerCase.id]: 'ready' });
      expect(second[0]?.detail).toBe('read-only API available');

      const third = await registry.health();
      expectStates(third, { [providerCase.id]: 'unavailable' });
    }
  });

  it('treats RSS configured+runtime and disabled paths as published state', async () => {
    const disabled = new ProviderRegistry([
      createRssHealthProvider({ configured: false, runtimeAvailable: false }),
    ]);
    await expect(disabled.health()).resolves.toEqual([
      {
        id: 'rss',
        version: '1',
        state: 'disabled',
        detail: 'provider disabled',
      },
    ]);

    const unavailable = new ProviderRegistry([
      createRssHealthProvider({ configured: true, runtimeAvailable: false }),
    ]);
    await expect(unavailable.health()).resolves.toEqual([
      {
        id: 'rss',
        version: '1',
        state: 'unavailable',
      },
    ]);

    const ready = new ProviderRegistry([
      createRssHealthProvider({ configured: true, runtimeAvailable: true }),
    ]);
    await expect(ready.health()).resolves.toEqual([
      {
        id: 'rss',
        version: '1',
        state: 'ready',
        detail: 'read-only API available',
      },
    ]);
  });

  it('publishes disabled when credentials or configuration are missing', async () => {
    const registry = new ProviderRegistry([
      createOllamaHealthProvider({ baseUrl: '', enabled: true }),
      createOpenAIHealthProvider({ apiKey: '', enabled: true }),
      createWebSearchHealthProvider({ apiKey: '  ', enabled: true }),
      createSleeperHealthProvider({ leagueId: 'not-a-league', enabled: true }),
      createGitHubHealthProvider({
        owner: '',
        repo: 'Jarvis',
        enabled: true,
      }),
    ]);

    const snapshots = await registry.health();
    expectStates(snapshots, {
      ollama: 'disabled',
      openai: 'disabled',
      'web-search': 'disabled',
      sleeper: 'disabled',
      github: 'disabled',
    });
  });

  it('never leaks tokens, query strings, or error messages into safe snapshots', async () => {
    const leakyFetch = async (): Promise<Response> => {
      throw new Error('authorization: Bearer sk-live-secret-token?query=1');
    };

    const registry = new ProviderRegistry([
      createOpenAIHealthProvider({
        apiKey: 'sk-live-secret-token',
        enabled: true,
        fetch: leakyFetch,
      }),
      createGitHubHealthProvider({
        owner: 'tjhiggy',
        repo: 'Jarvis',
        token: 'ghp_secret',
        enabled: true,
        fetch: leakyFetch,
      }),
    ]);

    const snapshots = await registry.health();
    const serialized = JSON.stringify(snapshots);
    expect(serialized).not.toMatch(/sk-live|ghp_|Bearer|query=/i);
    for (const snapshot of snapshots) {
      expect(snapshot.state).toBe('unavailable');
      expect(snapshot.detail).toBeUndefined();
    }
  });
});
