import type { AnalyticsEvent } from './contracts.js';
import type { BroadcastCategory } from '../notifications/broadcast-policy.js';

export type DeliveryMetricName =
  | 'delivery_attempted'
  | 'delivery_succeeded'
  | 'delivery_failed'
  | 'delivery_suppressed'
  | 'delivery_retried';

export interface DeliveryMetricEvent {
  readonly serverId: string;
  readonly category: BroadcastCategory;
  readonly name: DeliveryMetricName;
  readonly occurredAt: string;
  readonly durationMs?: number;
}

export interface DeliveryMetricsSummaryRow {
  readonly serverId: string;
  readonly category: BroadcastCategory;
  readonly eventName: DeliveryMetricName;
  readonly count: number;
  readonly durationMs: number;
}

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
  recordDeliveryMetric(event: DeliveryMetricEvent): Promise<void>;
  deliveryMetricsSummary(
    serverId: string,
    since: Date,
  ): Promise<readonly DeliveryMetricsSummaryRow[]>;
}
