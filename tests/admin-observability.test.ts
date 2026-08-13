import { describe, expect, it } from 'vitest';
import { buildAdminObservabilityProjection } from '../src/admin/observability.js';

describe('Command Deck observability projection', () => {
  it('projects healthy aggregate readiness without content or secrets', () => {
    expect(
      buildAdminObservabilityProjection({
        metrics: { events: 4, failures: 0 },
        database: 'healthy',
        configuredFeatures: ['events', 'trivia'],
        configuredIntegrations: 2,
        totalIntegrations: 3,
      }),
    ).toEqual({
      health: 'healthy',
      events: 4,
      failures: 0,
      adoption: 2,
      integrationReadiness: 67,
    });
  });
  it('distinguishes degraded, unavailable, and empty states', () => {
    expect(
      buildAdminObservabilityProjection({
        metrics: { events: 2, failures: 1 },
        database: 'healthy',
        configuredFeatures: [],
        configuredIntegrations: 0,
        totalIntegrations: 0,
      }).health,
    ).toBe('degraded');
    expect(
      buildAdminObservabilityProjection({
        metrics: null,
        database: 'unavailable',
        configuredFeatures: [],
        configuredIntegrations: 0,
        totalIntegrations: 2,
      }),
    ).toEqual({
      health: 'unavailable',
      events: 0,
      failures: 0,
      adoption: 0,
      integrationReadiness: 0,
    });
  });
});
