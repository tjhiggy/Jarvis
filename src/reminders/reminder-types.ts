export type ReminderStatus =
  | 'pending'
  | 'claimed'
  | 'retry_pending'
  | 'delivery_uncertain'
  | 'delivered'
  | 'cancelled'
  | 'failed';

export type ReminderRecurrence = 'daily' | 'weekly';

export interface ReminderView {
  readonly id: string;
  readonly guildId: string;
  readonly channelId: string;
  readonly parentChannelId?: string;
  readonly ownerUserId: string;
  readonly message: string;
  readonly dueAt: Date;
  readonly recurrence?: ReminderRecurrence;
  readonly untilAt?: Date;
  readonly status: ReminderStatus;
  readonly attemptCount: number;
  readonly nextAttemptAt?: Date;
  readonly createdAt: Date;
  readonly deliveredAt?: Date;
  readonly cancelledAt?: Date;
  readonly failedAt?: Date;
  readonly failureCategory?:
    'unknown-channel' | 'permission' | 'rate-limit' | 'network' | 'service';
}

export interface ReminderStatusCounts {
  readonly pending: number;
  readonly retryPending: number;
  readonly deliveryUncertain: number;
  readonly failed: number;
}

export interface ParsedReminderDuration {
  readonly milliseconds: number;
  readonly canonical: string;
}
