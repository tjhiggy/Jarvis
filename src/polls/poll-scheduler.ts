import type { PollController } from './poll-controller.js';
import type { PollService } from './poll-service.js';
import type { PollStore } from './poll-store.js';
import {
  projectOperationalError,
  type OperationalLogger,
} from '../utils/logger.js';

const defaultIntervalMs = 30_000;
const defaultBatchSize = 100;

export interface PollSchedulerTimers {
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(handle: unknown): void;
}

export interface PollSchedulerDependencies {
  readonly service: Pick<PollService, 'closeExpired' | 'cleanup'>;
  readonly store: Pick<PollStore, 'listPendingSync'>;
  readonly controller: Pick<PollController, 'synchronize'>;
  readonly retentionDays?: number;
  readonly intervalMs?: number;
  readonly batchSize?: number;
  readonly now?: () => Date;
  readonly timers?: PollSchedulerTimers;
  readonly logger?: OperationalLogger;
}

const systemTimers: PollSchedulerTimers = {
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle as NodeJS.Timeout),
};

const noOpLogger: OperationalLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** Bounded durable poll maintenance that never overlaps itself. */
export class PollScheduler {
  private readonly retentionDays: number;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly now: () => Date;
  private readonly timers: PollSchedulerTimers;
  private readonly logger: OperationalLogger;
  private intervalHandle: unknown;
  private activeTick: Promise<void> | undefined;
  private stopped = false;
  private started = false;
  private healthyState = true;

  constructor(private readonly dependencies: PollSchedulerDependencies) {
    this.retentionDays = dependencies.retentionDays ?? 30;
    this.intervalMs = dependencies.intervalMs ?? defaultIntervalMs;
    this.batchSize = dependencies.batchSize ?? defaultBatchSize;
    this.now = dependencies.now ?? (() => new Date());
    this.timers = dependencies.timers ?? systemTimers;
    this.logger = dependencies.logger ?? noOpLogger;
    validatePositiveInteger('retentionDays', this.retentionDays);
    validatePositiveInteger('intervalMs', this.intervalMs);
    validatePositiveInteger('batchSize', this.batchSize);
  }

  get healthy(): boolean {
    return this.healthyState;
  }

  start(): void {
    if (this.started || this.stopped) {
      return;
    }
    this.started = true;
    this.intervalHandle = this.timers.setInterval(() => {
      void this.runNow();
    }, this.intervalMs);
    void this.runNow();
  }

  runNow(): Promise<void> {
    if (this.stopped) {
      return Promise.resolve();
    }
    if (this.activeTick !== undefined) {
      return this.activeTick;
    }
    const tick = this.executeTick();
    this.activeTick = tick;
    void tick.finally(() => {
      if (this.activeTick === tick) {
        this.activeTick = undefined;
      }
    });
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
    let failed = false;
    let closedCount = 0;
    let synchronizedCount = 0;
    let cleanedCount = 0;

    try {
      const closed = await this.dependencies.service.closeExpired(now);
      closedCount = closed.length;
      const result = await this.synchronizeAll(closed);
      synchronizedCount += result.count;
      failed ||= result.failed;
    } catch (error) {
      failed = true;
      this.logFailure('close_due', error);
    }

    try {
      const pending = await this.dependencies.store.listPendingSync(
        now,
        this.batchSize,
      );
      const result = await this.synchronizeAll(pending);
      synchronizedCount += result.count;
      failed ||= result.failed;
    } catch (error) {
      failed = true;
      this.logFailure('pending_sync', error);
    }

    try {
      const cutoff = new Date(now.getTime());
      cutoff.setUTCDate(cutoff.getUTCDate() - this.retentionDays);
      cleanedCount = await this.dependencies.service.cleanup(cutoff);
    } catch (error) {
      failed = true;
      this.logFailure('cleanup', error);
    }

    this.healthyState = !failed;
    if (!failed) {
      this.logger.info(
        {
          operation: 'poll_scheduler',
          outcome: 'success',
          closedCount,
          synchronizedCount,
          cleanedCount,
        },
        'Poll scheduler tick completed.',
      );
    }
  }

  private async synchronizeAll(
    polls: readonly Parameters<PollController['synchronize']>[0][],
  ): Promise<Readonly<{ count: number; failed: boolean }>> {
    let count = 0;
    let failed = false;
    for (const poll of polls) {
      try {
        await this.dependencies.controller.synchronize(poll);
        count += 1;
      } catch (error) {
        failed = true;
        this.logFailure('synchronize', error, poll.id);
      }
    }
    return { count, failed };
  }

  private logFailure(operation: string, error: unknown, pollId?: string): void {
    this.logger.warn(
      {
        operation,
        ...(pollId === undefined ? {} : { pollId }),
        ...projectOperationalError(error, 'poll_scheduler'),
      },
      'Poll scheduler operation failed.',
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
