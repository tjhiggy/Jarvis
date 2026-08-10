import type { ReminderStatusCounts, ReminderView } from './reminder-types.js';

export interface CreateReminderInput {
  readonly id: string;
  readonly guildId: string;
  readonly channelId: string;
  readonly parentChannelId?: string;
  readonly ownerUserId: string;
  readonly message: string;
  readonly dueAt: Date;
  readonly createdAt: Date;
}

export type ReminderFailureCategory =
  'unknown-channel' | 'permission' | 'rate-limit' | 'network' | 'service';

export class ReminderActiveLimitError extends Error {}
export class ReminderStateConflictError extends Error {}

export interface ReminderStore {
  create(
    input: CreateReminderInput,
    activeLimit: number,
  ): Promise<ReminderView>;
  listByOwner(
    guildId: string,
    ownerUserId: string,
  ): Promise<readonly ReminderView[]>;
  listByGuild?(guildId: string): Promise<readonly ReminderView[]>;
  cancelAny?(guildId: string, reminderId: string, now: Date): Promise<ReminderView | undefined>;
  cancelOwned(
    guildId: string,
    ownerUserId: string,
    reminderId: string,
    now: Date,
  ): Promise<ReminderView | undefined>;
  recoverExpiredClaims(leaseCutoff: Date, now: Date): Promise<number>;
  claimDue(
    now: Date,
    leaseId: string,
    limit: number,
  ): Promise<readonly ReminderView[]>;
  markDelivered(
    reminderId: string,
    leaseId: string,
    deliveredAt: Date,
  ): Promise<void>;
  markRetry(
    reminderId: string,
    leaseId: string,
    attemptCount: number,
    nextAttemptAt: Date,
    category: ReminderFailureCategory,
  ): Promise<void>;
  markFailed(
    reminderId: string,
    leaseId: string,
    failedAt: Date,
    category: ReminderFailureCategory,
  ): Promise<void>;
  markDeliveryUncertain(
    reminderId: string,
    leaseId: string,
    uncertainAt: Date,
  ): Promise<void>;
  cleanup(cutoff: Date, limit: number): Promise<number>;
  statusCounts(): Promise<ReminderStatusCounts>;
  healthCheck(): Promise<boolean>;
  closeConnection(): Promise<void>;
}
