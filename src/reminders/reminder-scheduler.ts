import type {
  ReminderDeliveryGateway,
  ReminderDeliveryOutcome,
} from './reminder-delivery-gateway.js';
import { createReminderLeaseId } from './reminder-identity.js';
import type {
  ReminderFailureCategory,
  ReminderStore,
} from './reminder-store.js';
import type { ReminderView } from './reminder-types.js';
import type { OperationalLogger } from '../utils/logger.js';

const defaultIntervalMs = 30_000;
const defaultBatchSize = 50;
const defaultCleanupBatchSize = 100;
const defaultLeaseTimeoutMs = 5 * 60_000;
const defaultRetentionDays = 7;
const defaultRetryDelaysMs = [60_000, 300_000, 900_000] as const;

export interface ReminderSchedulerTimers {
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface ReminderSchedulerDependencies {
  readonly store: ReminderStore;
  readonly gateway: ReminderDeliveryGateway;
  readonly intervalMs?: number;
  readonly batchSize?: number;
  readonly cleanupBatchSize?: number;
  readonly leaseTimeoutMs?: number;
  readonly retentionDays?: number;
  readonly retryDelaysMs?: readonly [number, number, number];
  readonly now?: () => Date;
  readonly createLeaseId?: () => string;
  readonly timers?: ReminderSchedulerTimers;
  readonly logger?: OperationalLogger;
}

const systemTimers: ReminderSchedulerTimers = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

const noOpLogger: OperationalLogger = {
  info: () => undefined,
  warn: () => undefined,
};

interface TickCounts {
  recoveredCount: number;
  claimedCount: number;
  deliveredCount: number;
  retryCount: number;
  failedCount: number;
  uncertainCount: number;
  cleanedCount: number;
  failureCategoryCounts: Partial<Record<ReminderFailureCategory, number>>;
}

type SchedulerFailureOperation =
  | 'recover_expired_claims'
  | 'claim_due'
  | 'deliver'
  | 'persist_delivery_outcome'
  | 'cleanup';

type SchedulerFailureCategory = 'storage' | 'delivery' | 'delivery-state';

/** Bounded durable reminder delivery that never overlaps itself. */
export class ReminderScheduler {
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly cleanupBatchSize: number;
  private readonly leaseTimeoutMs: number;
  private readonly retentionDays: number;
  private readonly retryDelaysMs: readonly [number, number, number];
  private readonly now: () => Date;
  private readonly createLeaseId: () => string;
  private readonly timers: ReminderSchedulerTimers;
  private readonly logger: OperationalLogger;
  private intervalHandle: unknown;
  private activeTick: Promise<void> | undefined;
  private started = false;
  private stopped = false;
  private healthyState = true;

  constructor(private readonly dependencies: ReminderSchedulerDependencies) {
    this.intervalMs = dependencies.intervalMs ?? defaultIntervalMs;
    this.batchSize = dependencies.batchSize ?? defaultBatchSize;
    this.cleanupBatchSize =
      dependencies.cleanupBatchSize ?? defaultCleanupBatchSize;
    this.leaseTimeoutMs = dependencies.leaseTimeoutMs ?? defaultLeaseTimeoutMs;
    this.retentionDays = dependencies.retentionDays ?? defaultRetentionDays;
    const retryDelaysMs = dependencies.retryDelaysMs ?? defaultRetryDelaysMs;
    if (retryDelaysMs.length !== 3) {
      throw new RangeError('retryDelaysMs must contain exactly three delays.');
    }
    this.retryDelaysMs = [...retryDelaysMs] as [number, number, number];
    this.now = dependencies.now ?? (() => new Date());
    this.createLeaseId = dependencies.createLeaseId ?? createReminderLeaseId;
    this.timers = dependencies.timers ?? systemTimers;
    this.logger = dependencies.logger ?? noOpLogger;

    validatePositiveInteger('intervalMs', this.intervalMs);
    validatePositiveInteger('batchSize', this.batchSize);
    validatePositiveInteger('cleanupBatchSize', this.cleanupBatchSize);
    validatePositiveInteger('leaseTimeoutMs', this.leaseTimeoutMs);
    validatePositiveInteger('retentionDays', this.retentionDays);
    this.retryDelaysMs.forEach((delay, index) => {
      validatePositiveInteger(`retryDelaysMs[${index}]`, delay);
    });
  }

  get healthy(): boolean {
    return this.healthyState;
  }

  start(): void {
    if (this.started || this.stopped) return;
    this.started = true;
    this.intervalHandle = this.timers.setInterval(() => {
      void this.runNow().catch(() => undefined);
    }, this.intervalMs);
    void this.runNow().catch(() => undefined);
  }

  runNow(): Promise<void> {
    if (this.stopped) {
      return Promise.reject(new Error('Reminder scheduler is stopped.'));
    }
    if (this.activeTick !== undefined) return this.activeTick;

    const tick = this.executeTick();
    this.activeTick = tick;
    const clearActiveTick = (): void => {
      if (this.activeTick === tick) this.activeTick = undefined;
    };
    void tick.then(clearActiveTick, clearActiveTick);
    return tick;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.intervalHandle !== undefined) {
      this.timers.clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    await this.activeTick;
  }

  private async executeTick(): Promise<void> {
    const now = validNow(this.now());
    const leaseCutoff = new Date(now.getTime() - this.leaseTimeoutMs);
    const counts: TickCounts = {
      recoveredCount: 0,
      claimedCount: 0,
      deliveredCount: 0,
      retryCount: 0,
      failedCount: 0,
      uncertainCount: 0,
      cleanedCount: 0,
      failureCategoryCounts: {},
    };
    let failed = false;

    try {
      counts.recoveredCount =
        await this.dependencies.store.recoverExpiredClaims(leaseCutoff, now);
    } catch {
      failed = true;
      this.logFailure('recover_expired_claims');
    }

    let reminders: readonly ReminderView[] = [];
    let leaseId: string | undefined;
    try {
      leaseId = this.createLeaseId();
      reminders = await this.dependencies.store.claimDue(
        now,
        leaseId,
        this.batchSize,
      );
      counts.claimedCount = reminders.length;
    } catch {
      failed = true;
      this.logFailure('claim_due');
    }

    if (leaseId !== undefined) {
      for (const reminder of reminders) {
        let outcome: ReminderDeliveryOutcome;
        try {
          outcome = await this.dependencies.gateway.deliver(reminder, now);
        } catch {
          failed = true;
          this.logFailure('deliver');
          try {
            await this.dependencies.store.markDeliveryUncertain(
              reminder.id,
              leaseId,
              now,
            );
            counts.uncertainCount += 1;
          } catch {
            this.logFailure('persist_delivery_outcome');
          }
          continue;
        }

        try {
          await this.persistOutcome(reminder, leaseId, now, outcome, counts);
        } catch {
          failed = true;
          this.logFailure('persist_delivery_outcome');
        }
      }
    }

    try {
      const retentionMilliseconds = this.retentionDays * 24 * 60 * 60 * 1_000;
      const cutoff = new Date(now.getTime() - retentionMilliseconds);
      counts.cleanedCount = await this.dependencies.store.cleanup(
        cutoff,
        this.cleanupBatchSize,
      );
    } catch {
      failed = true;
      this.logFailure('cleanup');
    }

    this.healthyState = !failed;
    this.logger.info(
      {
        operation: 'reminder_scheduler',
        outcome: failed ? 'degraded' : 'success',
        ...counts,
      },
      'Reminder scheduler tick completed.',
    );
  }

  private async persistOutcome(
    reminder: ReminderView,
    leaseId: string,
    now: Date,
    outcome: ReminderDeliveryOutcome,
    counts: TickCounts,
  ): Promise<void> {
    switch (outcome.kind) {
      case 'delivered':
        await this.dependencies.store.markDelivered(reminder.id, leaseId, now);
        counts.deliveredCount += 1;
        return;
      case 'transient-failure': {
        incrementCategory(counts.failureCategoryCounts, outcome.category);
        const nextAttemptCount = reminder.attemptCount + 1;
        const retryDelay = this.retryDelaysMs[reminder.attemptCount];
        if (retryDelay === undefined) {
          await this.dependencies.store.markFailed(
            reminder.id,
            leaseId,
            now,
            outcome.category,
          );
          counts.failedCount += 1;
          return;
        }
        await this.dependencies.store.markRetry(
          reminder.id,
          leaseId,
          nextAttemptCount,
          new Date(now.getTime() + retryDelay),
          outcome.category,
        );
        counts.retryCount += 1;
        return;
      }
      case 'permanent-failure':
        incrementCategory(counts.failureCategoryCounts, outcome.category);
        await this.dependencies.store.markFailed(
          reminder.id,
          leaseId,
          now,
          outcome.category,
        );
        counts.failedCount += 1;
        return;
      case 'uncertain':
        await this.dependencies.store.markDeliveryUncertain(
          reminder.id,
          leaseId,
          now,
        );
        counts.uncertainCount += 1;
    }
  }

  private logFailure(operation: SchedulerFailureOperation): void {
    this.logger.warn(
      {
        operation,
        category: schedulerFailureCategory(operation),
        failureCount: 1,
      },
      'Reminder scheduler operation failed.',
    );
  }
}

function validatePositiveInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}

function validNow(value: Date): Date {
  return Number.isFinite(value.getTime())
    ? new Date(value.getTime())
    : new Date();
}

function incrementCategory(
  counts: Partial<Record<ReminderFailureCategory, number>>,
  category: ReminderFailureCategory,
): void {
  counts[category] = (counts[category] ?? 0) + 1;
}

function schedulerFailureCategory(
  operation: SchedulerFailureOperation,
): SchedulerFailureCategory {
  if (operation === 'deliver') return 'delivery';
  if (operation === 'persist_delivery_outcome') return 'delivery-state';
  return 'storage';
}
