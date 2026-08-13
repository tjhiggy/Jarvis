export interface AdminObservabilityInput {
  readonly metrics: { readonly events: number; readonly failures: number } | null;
  readonly database: 'healthy' | 'unavailable';
  readonly configuredFeatures: readonly string[];
  readonly configuredIntegrations: number;
  readonly totalIntegrations: number;
}

export interface AdminObservabilityProjection {
  readonly health: 'healthy' | 'degraded' | 'unavailable';
  readonly events: number;
  readonly failures: number;
  readonly adoption: number;
  readonly integrationReadiness: number;
}

const bounded = (value: number): number =>
  Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

export const buildAdminObservabilityProjection = (
  input: AdminObservabilityInput,
): AdminObservabilityProjection => {
  const events = bounded(input.metrics?.events ?? 0);
  const failures = bounded(input.metrics?.failures ?? 0);
  const adoption = input.configuredFeatures.length;
  const integrationReadiness =
    input.totalIntegrations === 0
      ? 0
      : Math.round((bounded(input.configuredIntegrations) / input.totalIntegrations) * 100);
  return {
    health:
      input.database === 'unavailable'
        ? 'unavailable'
        : failures > 0
          ? 'degraded'
          : 'healthy',
    events,
    failures,
    adoption,
    integrationReadiness: Math.min(100, Math.max(0, integrationReadiness)),
  };
};
