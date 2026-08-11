export type ProviderState = 'ready' | 'unavailable' | 'disabled';

export interface ProviderHealth {
  readonly state: ProviderState;
  readonly detail?: string;
  readonly [key: string]: unknown;
}

export interface SafeProviderHealth {
  readonly id: string;
  readonly version: string;
  readonly state: ProviderState;
  readonly detail?: string;
}

export interface ReadOnlyProvider {
  readonly id: string;
  readonly version: string;
  readonly health: () => Promise<ProviderHealth>;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, ReadOnlyProvider>();

  constructor(providers: readonly ReadOnlyProvider[] = []) {
    for (const provider of providers) {
      if (this.providers.has(provider.id)) {
        throw new Error(`Duplicate provider ID: ${provider.id}`);
      }
      this.providers.set(provider.id, provider);
    }
  }

  async health(): Promise<SafeProviderHealth[]> {
    const snapshots: SafeProviderHealth[] = [];
    for (const provider of this.providers.values()) {
      try {
        const health = await provider.health();
        const detail =
          health.detail === 'read-only API available'
            ? health.detail
            : health.detail === 'provider disabled'
              ? health.detail
              : undefined;
        snapshots.push({
          id: provider.id,
          version: provider.version,
          state: health.state,
          ...(detail === undefined ? {} : { detail }),
        });
      } catch {
        snapshots.push({
          id: provider.id,
          version: provider.version,
          state: 'unavailable',
          detail: 'provider health check failed',
        });
      }
    }
    return snapshots;
  }
}
