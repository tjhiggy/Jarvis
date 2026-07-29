import { PollCoordinator } from './poll-coordinator.js';
import type { PollDurationValue } from './poll-duration.js';
import { createPollId, createVoterKey } from './poll-identity.js';
import {
  PollReservationConflictError,
  type PollStore,
  type ReservePollInput,
} from './poll-store.js';
import type { PollView } from './poll-types.js';
import { validatePollInput } from './poll-validation.js';

export interface CreatePollRequest {
  readonly guildId: string;
  readonly conversationId: string;
  readonly channelId: string;
  readonly parentChannelId?: string;
  readonly creatorUserId: string;
  readonly question: string;
  readonly options: readonly string[];
  readonly duration: PollDurationValue;
}

export interface VoteRequest {
  readonly pollId: string;
  readonly guildId: string;
  readonly voterUserId: string;
  readonly optionIndex: number;
}

export interface ClosePollRequest {
  readonly pollId: string;
}

export interface VoteResult {
  readonly kind: 'recorded' | 'changed' | 'unchanged';
  readonly poll: PollView;
}

export type PollServiceErrorCode =
  | 'invalid_request'
  | 'capacity_reached'
  | 'creation_rate_limited'
  | 'creator_poll_exists'
  | 'poll_closed'
  | 'invalid_option'
  | 'not_found'
  | 'storage_error';

/** A content-free error suitable for mapping to a user-safe controller reply. */
export class PollServiceError extends Error {
  readonly code: PollServiceErrorCode;

  constructor(code: PollServiceErrorCode) {
    super(`Poll service operation failed: ${code}.`);
    this.name = 'PollServiceError';
    this.code = code;
  }
}

export interface PollService {
  reserve(request: CreatePollRequest): Promise<PollView>;
  activate(pollId: string, messageId: string): Promise<PollView>;
  fail(pollId: string): Promise<void>;
  vote(request: VoteRequest): Promise<VoteResult>;
  close(request: ClosePollRequest): Promise<PollView>;
  closeExpired(now: Date): Promise<readonly PollView[]>;
  cleanup(cutoff: Date): Promise<number>;
  markSynced(pollId: string): Promise<void>;
  markPendingSync(pollId: string, nextSyncAt: Date): Promise<void>;
  markOrphaned(pollId: string): Promise<void>;
}

export interface PollServiceDependencies {
  readonly store: PollStore;
  readonly coordinator?: PollCoordinator;
  readonly voterSecret: string;
  readonly now?: () => Date;
  readonly createId?: () => string;
  readonly createVoterKey?: (
    secret: string,
    guildId: string,
    pollId: string,
    userId: string,
  ) => string;
  readonly activePollLimit?: number;
  readonly creationLimit?: number;
  readonly creationWindowMs?: number;
  readonly maximumRateLimitKeys?: number;
}

const defaultActivePollLimit = 100;
const defaultCreationLimit = 3;
const defaultCreationWindowMs = 10 * 60 * 1_000;
const defaultMaximumRateLimitKeys = 10_000;
const globalReservationCoordinatorKey = '__poll_reservation_capacity__';

export class DurablePollService implements PollService {
  private readonly coordinator: PollCoordinator;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly voterKey: NonNullable<
    PollServiceDependencies['createVoterKey']
  >;
  private readonly activePollLimit: number;
  private readonly creationLimit: number;
  private readonly creationWindowMs: number;
  private readonly maximumRateLimitKeys: number;
  private readonly creationEvents = new Map<string, number[]>();

  constructor(private readonly dependencies: PollServiceDependencies) {
    this.coordinator = dependencies.coordinator ?? new PollCoordinator();
    this.now = dependencies.now ?? (() => new Date());
    this.createId = dependencies.createId ?? createPollId;
    this.voterKey = dependencies.createVoterKey ?? createVoterKey;
    this.activePollLimit =
      dependencies.activePollLimit ?? defaultActivePollLimit;
    this.creationLimit = dependencies.creationLimit ?? defaultCreationLimit;
    this.creationWindowMs =
      dependencies.creationWindowMs ?? defaultCreationWindowMs;
    this.maximumRateLimitKeys =
      dependencies.maximumRateLimitKeys ?? defaultMaximumRateLimitKeys;
    validateDependencies(this.dependencies, {
      activePollLimit: this.activePollLimit,
      creationLimit: this.creationLimit,
      creationWindowMs: this.creationWindowMs,
      maximumRateLimitKeys: this.maximumRateLimitKeys,
    });
  }

  async reserve(request: CreatePollRequest): Promise<PollView> {
    const normalized = normalizeCreateRequest(request);
    const validated = validatePollInput({
      question: normalized.question,
      options: normalized.options,
      duration: normalized.duration,
    });
    const createdAt = requireValidDate(this.now());

    const input: ReservePollInput = {
      id: normalizePollId(this.createId()),
      guildId: normalized.guildId,
      conversationId: normalized.conversationId,
      channelId: normalized.channelId,
      creatorUserId: normalized.creatorUserId,
      question: validated.question,
      options: validated.options,
      closesAt: new Date(createdAt.getTime() + validated.durationMs),
      createdAt,
      ...(normalized.parentChannelId === undefined
        ? {}
        : { parentChannelId: normalized.parentChannelId }),
    };
    return this.coordinator.run(globalReservationCoordinatorKey, async () => {
      if (
        (await this.dependencies.store.countCapacityOccupying()) >=
        this.activePollLimit
      ) {
        throw new PollServiceError('capacity_reached');
      }
      if (
        await this.dependencies.store.hasActiveByCreatorInConversation(
          normalized.creatorUserId,
          normalized.conversationId,
        )
      ) {
        throw new PollServiceError('creator_poll_exists');
      }
      this.consumeCreationRate(normalized.creatorUserId, createdAt.getTime());
      try {
        return await this.dependencies.store.reserve(input);
      } catch (error) {
        if (error instanceof PollReservationConflictError) {
          throw new PollServiceError('creator_poll_exists');
        }
        throw toServiceError(error);
      }
    });
  }

  async activate(pollId: string, messageId: string): Promise<PollView> {
    const id = normalizePollId(pollId);
    const normalizedMessageId = requireIdentifier(messageId);
    return this.run(id, async () => {
      try {
        return await this.dependencies.store.activate(id, normalizedMessageId);
      } catch (error) {
        throw toServiceError(error);
      }
    });
  }

  async fail(pollId: string): Promise<void> {
    const id = normalizePollId(pollId);
    await this.run(id, async () => {
      try {
        await this.dependencies.store.markFailed(id);
      } catch (error) {
        throw toServiceError(error);
      }
    });
  }

  async vote(request: VoteRequest): Promise<VoteResult> {
    const pollId = normalizePollId(request.pollId);
    const guildId = requireIdentifier(request.guildId);
    const voterUserId = requireIdentifier(request.voterUserId);
    const optionIndex = request.optionIndex;
    if (
      !Number.isSafeInteger(optionIndex) ||
      optionIndex < 0 ||
      optionIndex > 4
    ) {
      throw new PollServiceError('invalid_option');
    }
    const now = requireValidDate(this.now());
    const voterKey = this.voterKey(
      this.dependencies.voterSecret,
      guildId,
      pollId,
      voterUserId,
    );

    return this.run(pollId, async () => {
      try {
        return await this.dependencies.store.recordVote({
          pollId,
          voterKey,
          optionIndex,
          now,
        });
      } catch (error) {
        throw mapVoteError(error);
      }
    });
  }

  async close(request: ClosePollRequest): Promise<PollView> {
    const pollId = normalizePollId(request.pollId);
    const now = requireValidDate(this.now());
    return this.run(pollId, async () => {
      try {
        return await this.dependencies.store.close(pollId, now);
      } catch (error) {
        throw toServiceError(error);
      }
    });
  }

  async closeExpired(now: Date): Promise<readonly PollView[]> {
    const current = requireValidDate(now);
    try {
      return await this.dependencies.store.closeDue(
        current,
        this.activePollLimit,
      );
    } catch (error) {
      throw toServiceError(error);
    }
  }

  async cleanup(cutoff: Date): Promise<number> {
    try {
      return await this.dependencies.store.cleanup(requireValidDate(cutoff));
    } catch (error) {
      throw toServiceError(error);
    }
  }

  async markSynced(pollId: string): Promise<void> {
    await this.updateSyncState(pollId, (id) =>
      this.dependencies.store.markSynced(id),
    );
  }

  async markPendingSync(pollId: string, nextSyncAt: Date): Promise<void> {
    const retryAt = requireValidDate(nextSyncAt);
    await this.updateSyncState(pollId, (id) =>
      this.dependencies.store.markPendingSync(id, retryAt),
    );
  }

  async markOrphaned(pollId: string): Promise<void> {
    await this.updateSyncState(pollId, (id) =>
      this.dependencies.store.markOrphaned(id),
    );
  }

  private async updateSyncState(
    pollId: string,
    operation: (id: string) => Promise<void>,
  ): Promise<void> {
    const id = normalizePollId(pollId);
    await this.run(id, async () => {
      try {
        await operation(id);
      } catch (error) {
        throw toServiceError(error);
      }
    });
  }

  private run<T>(pollId: string, operation: () => Promise<T>): Promise<T> {
    return this.coordinator.run(pollId, operation);
  }

  private consumeCreationRate(creatorUserId: string, now: number): void {
    const cutoff = now - this.creationWindowMs;
    for (const [key, events] of this.creationEvents) {
      const firstActive = events.findIndex((event) => event > cutoff);
      if (firstActive === -1) {
        this.creationEvents.delete(key);
      } else if (firstActive > 0) {
        events.splice(0, firstActive);
      }
    }

    const events = this.creationEvents.get(creatorUserId) ?? [];
    this.creationEvents.delete(creatorUserId);
    this.creationEvents.set(creatorUserId, events);
    if (events.length >= this.creationLimit) {
      throw new PollServiceError('creation_rate_limited');
    }
    events.push(now);
    while (this.creationEvents.size > this.maximumRateLimitKeys) {
      const oldest = this.creationEvents.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.creationEvents.delete(oldest);
    }
  }
}

function validateDependencies(
  dependencies: PollServiceDependencies,
  limits: Readonly<{
    activePollLimit: number;
    creationLimit: number;
    creationWindowMs: number;
    maximumRateLimitKeys: number;
  }>,
): void {
  if (dependencies.voterSecret.trim().length < 32) {
    throw new RangeError(
      'Poll voter secret must contain at least 32 characters.',
    );
  }
  if (
    Object.values(limits).some(
      (value) => !Number.isSafeInteger(value) || value < 1,
    )
  ) {
    throw new RangeError('Poll service limits must be positive safe integers.');
  }
}

function normalizeCreateRequest(request: CreatePollRequest): CreatePollRequest {
  const parentChannelId = request.parentChannelId?.trim();
  return {
    guildId: requireIdentifier(request.guildId),
    conversationId: requireIdentifier(request.conversationId),
    channelId: requireIdentifier(request.channelId),
    creatorUserId: requireIdentifier(request.creatorUserId),
    question: request.question,
    options: request.options,
    duration: request.duration,
    ...(parentChannelId === undefined || parentChannelId === ''
      ? {}
      : { parentChannelId }),
  };
}

function requireIdentifier(value: string): string {
  const normalized = value.trim();
  if (normalized === '') {
    throw new PollServiceError('invalid_request');
  }
  return normalized;
}

function normalizePollId(value: string): string {
  const pollId = requireIdentifier(value);
  if (!/^[a-z2-7]{12}$/.test(pollId)) {
    throw new PollServiceError('invalid_request');
  }
  return pollId;
}

function requireValidDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) {
    throw new PollServiceError('invalid_request');
  }
  return new Date(value.getTime());
}

function mapVoteError(error: unknown): PollServiceError {
  if (error instanceof PollServiceError) {
    return error;
  }
  if (error instanceof RangeError) {
    return new PollServiceError('invalid_option');
  }
  if (error instanceof Error && /closed/i.test(error.message)) {
    return new PollServiceError('poll_closed');
  }
  return toServiceError(error);
}

function toServiceError(error: unknown): PollServiceError {
  if (error instanceof PollServiceError) {
    return error;
  }
  if (error instanceof Error && /not found/i.test(error.message)) {
    return new PollServiceError('not_found');
  }
  return new PollServiceError('storage_error');
}
