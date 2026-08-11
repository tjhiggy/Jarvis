import type { RateLimiter } from '../security/rate-limiter.js';
import { parseReminderDuration } from './reminder-duration.js';
import { createReminderId } from './reminder-identity.js';
import {
  ReminderActiveLimitError,
  type ReminderStore,
} from './reminder-store.js';
import type { ReminderView } from './reminder-types.js';

export type ReminderServiceErrorCode =
  'invalid-request' | 'rate-limit' | 'active-limit';

export class ReminderServiceError extends Error {
  readonly code: ReminderServiceErrorCode;
  readonly retryAfterMs?: number;

  constructor(code: ReminderServiceErrorCode, retryAfterMs?: number) {
    super(`Reminder service operation failed: ${code}.`);
    this.name = 'ReminderServiceError';
    this.code = code;
    if (retryAfterMs !== undefined) {
      this.retryAfterMs = retryAfterMs;
    }
  }
}

export interface ReminderServiceDependencies {
  readonly store: ReminderStore;
  readonly rateLimiter: Pick<RateLimiter, 'consume'>;
  readonly now?: () => Date;
  readonly createId?: () => string;
  readonly activeLimit?: number;
}

export class ReminderService {
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly activeLimit: number;

  constructor(private readonly dependencies: ReminderServiceDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.createId = dependencies.createId ?? createReminderId;
    this.activeLimit = dependencies.activeLimit ?? 10;
    if (!Number.isSafeInteger(this.activeLimit) || this.activeLimit < 1) {
      throw new RangeError(
        'Reminder active limit must be a positive safe integer.',
      );
    }
  }

  async set(request: {
    readonly guildId: string;
    readonly channelId: string;
    readonly parentChannelId?: string;
    readonly ownerUserId: string;
    readonly duration: string;
    readonly message: string;
  }): Promise<ReminderView> {
    const input = requireRequest(request);
    const guildId = requireIdentifier(input.guildId);
    const channelId = requireIdentifier(input.channelId);
    const ownerUserId = requireIdentifier(input.ownerUserId);
    const parentChannelId = optionalIdentifier(input.parentChannelId);
    const message = requireString(input.message).trim();
    const duration = parseReminderDuration(requireString(input.duration));
    if (
      message.length === 0 ||
      message.length > 500 ||
      duration === undefined
    ) {
      throw new ReminderServiceError('invalid-request');
    }
    const createdAt = requireValidDate(this.now());
    const id = requireReminderId(this.createId());

    this.consume(guildId, ownerUserId);
    try {
      const reminder = await this.dependencies.store.create(
        {
          id,
          guildId,
          channelId,
          ownerUserId,
          message,
          dueAt: new Date(createdAt.getTime() + duration.milliseconds),
          createdAt: new Date(createdAt),
          ...(parentChannelId === undefined ? {} : { parentChannelId }),
        },
        this.activeLimit,
      );
      return copyReminder(reminder);
    } catch (error) {
      if (error instanceof ReminderActiveLimitError) {
        throw new ReminderServiceError('active-limit');
      }
      throw error;
    }
  }

  async list(request: {
    readonly guildId: string;
    readonly ownerUserId: string;
  }): Promise<readonly ReminderView[]> {
    const input = requireRequest(request);
    const guildId = requireIdentifier(input.guildId);
    const ownerUserId = requireIdentifier(input.ownerUserId);
    this.consume(guildId, ownerUserId);
    return (
      await this.dependencies.store.listByOwner(guildId, ownerUserId)
    ).map(copyReminder);
  }

  async cancel(request: {
    readonly guildId: string;
    readonly ownerUserId: string;
    readonly reminderId: string;
  }): Promise<ReminderView | undefined> {
    const input = requireRequest(request);
    const guildId = requireIdentifier(input.guildId);
    const ownerUserId = requireIdentifier(input.ownerUserId);
    const reminderId = requireReminderId(input.reminderId);
    const cancelledAt = requireValidDate(this.now());
    this.consume(guildId, ownerUserId);
    const reminder = await this.dependencies.store.cancelOwned(
      guildId,
      ownerUserId,
      reminderId,
      new Date(cancelledAt),
    );
    return reminder === undefined ? undefined : copyReminder(reminder);
  }

  async sharedSet(request: {
    guildId: string;
    channelId: string;
    ownerUserId: string;
    duration: string;
    message: string;
  }): Promise<ReminderView> {
    return this.set(request);
  }
  async sharedList(request: {
    guildId: string;
    ownerUserId: string;
  }): Promise<readonly ReminderView[]> {
    const input = requireRequest(request);
    const guildId = requireIdentifier(input.guildId);
    const owner = requireIdentifier(input.ownerUserId);
    this.consume(guildId, owner);
    if (!this.dependencies.store.listByGuild)
      throw new ReminderServiceError('invalid-request');
    return (await this.dependencies.store.listByGuild(guildId)).map(
      copyReminder,
    );
  }
  async sharedCancel(request: {
    guildId: string;
    ownerUserId: string;
    reminderId: string;
  }): Promise<ReminderView | undefined> {
    const input = requireRequest(request);
    const guildId = requireIdentifier(input.guildId);
    const owner = requireIdentifier(input.ownerUserId);
    const id = requireReminderId(input.reminderId);
    this.consume(guildId, owner);
    if (!this.dependencies.store.cancelAny)
      throw new ReminderServiceError('invalid-request');
    return this.dependencies.store.cancelAny(
      guildId,
      id,
      requireValidDate(this.now()),
    );
  }

  private consume(guildId: string, ownerUserId: string): void {
    const result = this.dependencies.rateLimiter.consume(
      JSON.stringify([guildId, ownerUserId]),
    );
    if (!result.allowed) {
      throw new ReminderServiceError('rate-limit', result.retryAfterMs);
    }
  }
}

function requireRequest(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ReminderServiceError('invalid-request');
  }
  return value as Readonly<Record<string, unknown>>;
}

function requireString(value: unknown): string {
  if (typeof value !== 'string') {
    throw new ReminderServiceError('invalid-request');
  }
  return value;
}

function requireIdentifier(value: unknown): string {
  const normalized = requireString(value).trim();
  if (normalized === '') {
    throw new ReminderServiceError('invalid-request');
  }
  return normalized;
}

function optionalIdentifier(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireIdentifier(value);
}

function requireReminderId(value: unknown): string {
  const id = requireIdentifier(value);
  if (!/^[a-z2-7]{12}$/.test(id)) {
    throw new ReminderServiceError('invalid-request');
  }
  return id;
}

function requireValidDate(value: unknown): Date {
  if (!(value instanceof Date)) {
    throw new ReminderServiceError('invalid-request');
  }
  if (!Number.isFinite(value.getTime())) {
    throw new ReminderServiceError('invalid-request');
  }
  return new Date(value);
}

function copyReminder(reminder: ReminderView): ReminderView {
  return {
    ...reminder,
    dueAt: new Date(reminder.dueAt),
    createdAt: new Date(reminder.createdAt),
    ...(reminder.nextAttemptAt === undefined
      ? {}
      : { nextAttemptAt: new Date(reminder.nextAttemptAt) }),
    ...(reminder.deliveredAt === undefined
      ? {}
      : { deliveredAt: new Date(reminder.deliveredAt) }),
    ...(reminder.cancelledAt === undefined
      ? {}
      : { cancelledAt: new Date(reminder.cancelledAt) }),
    ...(reminder.failedAt === undefined
      ? {}
      : { failedAt: new Date(reminder.failedAt) }),
  };
}
