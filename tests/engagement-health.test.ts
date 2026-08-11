import { describe, expect, it } from 'vitest';
import { collectEngagementHealth } from '../src/engagement/health.js';

describe('engagement health', () => {
  it('reports configured features, aggregate records, and scheduler state without content', async () => {
    const health = await collectEngagementHealth({
      enabled: true,
      repository: {
        healthCheck: async () => true,
        statusCounts: async () => ({
          introductions: 2,
          suggestions: 3,
          events: 4,
          rsvps: 5,
          triviaRounds: 6,
        }),
        engagementPaused: async () => false,
      },
      schedulers: {
        events: {
          healthy: true,
          lastRun: { status: 'success', at: new Date('2026-08-08T12:00:00Z') },
        },
        recaps: {
          healthy: false,
          lastRun: { status: 'error', at: new Date('2026-08-08T11:00:00Z') },
        },
      },
    });

    expect(health).toEqual({
      enabled: true,
      paused: false,
      database: 'healthy',
      recordCounts: {
        introductions: 2,
        suggestions: 3,
        events: 4,
        rsvps: 5,
        triviaRounds: 6,
      },
      schedulers: {
        events: { state: 'healthy', lastRun: 'success' },
        recaps: { state: 'degraded', lastRun: 'error' },
      },
    });
    expect(JSON.stringify(health)).not.toMatch(
      /prompt|suggestion text|rsvp reason|token/i,
    );
  });

  it('fails closed when engagement diagnostics are unavailable', async () => {
    const health = await collectEngagementHealth({ enabled: true });

    expect(health).toEqual({
      enabled: true,
      paused: true,
      database: 'unavailable',
      recordCounts: 'unavailable',
      schedulers: {},
    });
  });
});
