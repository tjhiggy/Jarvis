import type { AnalyticsEvent } from './contracts.js';

export interface MetricsSummaryRow {
  readonly serverId: string;
  readonly feature: string;
  readonly command: string;
  readonly eventName: AnalyticsEvent['name'];
  readonly count: number;
  readonly durationMs: number;
}

export interface PlatformMetricsRepository {
  recordAnalyticsEvent(event: AnalyticsEvent): Promise<void>;
  analyticsSummary(
    serverId: string,
    since: Date,
  ): Promise<readonly MetricsSummaryRow[]>;
}
