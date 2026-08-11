import { describe, expect, it } from 'vitest';
import {
  ProviderRegistry,
  type ReadOnlyProvider,
} from '../src/providers/provider-contract.js';

describe('read-only provider contract', () => {
  it('returns safe health snapshots without provider secrets', async () => {
    const provider: ReadOnlyProvider = {
      id: 'sleeper',
      version: '1',
      health: async () => ({
        state: 'ready',
        detail: 'token=must-not-escape',
        secret: 'must not escape',
      }),
    };
    const registry = new ProviderRegistry([provider]);

    await expect(registry.health()).resolves.toEqual([
      {
        id: 'sleeper',
        version: '1',
        state: 'ready',
      },
    ]);
  });

  it('rejects duplicate provider IDs and normalizes unknown failures', async () => {
    expect(
      () =>
        new ProviderRegistry([
          {
            id: 'github',
            version: '1',
            health: async () => ({ state: 'ready' }),
          },
          {
            id: 'github',
            version: '2',
            health: async () => ({ state: 'ready' }),
          },
        ]),
    ).toThrow(/duplicate/i);

    const registry = new ProviderRegistry([
      {
        id: 'mcp',
        version: '1',
        health: async () => {
          throw new Error('token=secret');
        },
      },
    ]);
    await expect(registry.health()).resolves.toEqual([
      {
        id: 'mcp',
        version: '1',
        state: 'unavailable',
        detail: 'provider health check failed',
      },
    ]);
  });
});
