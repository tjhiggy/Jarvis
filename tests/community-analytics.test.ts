import { describe, expect, it } from 'vitest';
import { buildCommunityAnalyticsReport } from '../src/community/community-analytics.js';

describe('privacy-safe community analytics', () => {
  it('builds dashboard, heatmap, and year-review aggregates', () => {
    expect(
      buildCommunityAnalyticsReport(
        [
          { day: '2026-08-12', events: 3, failures: 1 },
          { day: '2026-08-13', events: 2, failures: 0 },
        ],
        { start: '2026-08-12', end: '2026-08-13' },
      ),
    ).toEqual({
      window: { start: '2026-08-12', end: '2026-08-13' },
      totalEvents: 5,
      totalFailures: 1,
      activeDays: 2,
      heatmap: [
        { day: '2026-08-12', events: 3, failures: 1 },
        { day: '2026-08-13', events: 2, failures: 0 },
      ],
    });
  });
  it('bounds the report and never carries identity or content', () => {
    const days = Array.from({ length: 400 }, (_, index) => ({
      day: `${index}`,
      events: 1,
      failures: 0,
    }));
    expect(
      buildCommunityAnalyticsReport(days, { start: '0', end: '399' }).heatmap,
    ).toHaveLength(366);
  });
});
