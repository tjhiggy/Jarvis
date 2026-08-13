export interface CommunityMetricDay {
  readonly day: string;
  readonly events: number;
  readonly failures: number;
}

export interface CommunityAnalyticsReport {
  readonly window: { readonly start: string; readonly end: string };
  readonly totalEvents: number;
  readonly totalFailures: number;
  readonly activeDays: number;
  readonly heatmap: readonly CommunityMetricDay[];
}

export const buildCommunityAnalyticsReport = (
  days: readonly CommunityMetricDay[],
  window: { readonly start: string; readonly end: string },
): CommunityAnalyticsReport => {
  const heatmap = days.slice(-366).map((day) => ({
    day: day.day,
    events: Number.isFinite(day.events) ? Math.max(0, Math.floor(day.events)) : 0,
    failures: Number.isFinite(day.failures) ? Math.max(0, Math.floor(day.failures)) : 0,
  }));
  return {
    window,
    totalEvents: heatmap.reduce((sum, day) => sum + day.events, 0),
    totalFailures: heatmap.reduce((sum, day) => sum + day.failures, 0),
    activeDays: heatmap.filter((day) => day.events > 0).length,
    heatmap,
  };
};
