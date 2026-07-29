import type { PollView } from './poll-types.js';

export class PollReservationConflictError extends Error {
  constructor() {
    super('A poll is already being created or active in this conversation.');
    this.name = 'PollReservationConflictError';
  }
}

/** Content-free rejection when a component interaction is not the poll's message. */
export class PollVoteTargetMismatchError extends Error {
  constructor() {
    super('Poll vote target does not match the active poll.');
    this.name = 'PollVoteTargetMismatchError';
  }
}

export interface ReservePollInput {
  readonly id: string;
  readonly guildId: string;
  readonly conversationId: string;
  readonly channelId: string;
  readonly parentChannelId?: string;
  readonly creatorUserId: string;
  readonly question: string;
  readonly options: readonly string[];
  readonly closesAt: Date;
  readonly createdAt: Date;
}

export interface PollStore {
  reserve(input: ReservePollInput): Promise<PollView>;
  activate(pollId: string, messageId: string): Promise<PollView>;
  markFailed(pollId: string): Promise<void>;
  recordVote(input: {
    readonly pollId: string;
    readonly guildId: string;
    readonly channelId: string;
    readonly messageId: string;
    readonly voterKey: string;
    readonly optionIndex: number;
    readonly now: Date;
  }): Promise<{
    readonly kind: 'recorded' | 'changed' | 'unchanged';
    readonly poll: PollView;
  }>;
  close(pollId: string, now: Date): Promise<PollView>;
  closeDue(now: Date, limit: number): Promise<readonly PollView[]>;
  markPendingSync(pollId: string, nextSyncAt: Date): Promise<void>;
  markSynced(pollId: string): Promise<void>;
  markOrphaned(pollId: string): Promise<void>;
  listPendingSync(now: Date, limit: number): Promise<readonly PollView[]>;
  /** Counts reservations which occupy one of the global active-poll slots. */
  countCapacityOccupying(): Promise<number>;
  hasActiveByCreatorInConversation(
    creatorUserId: string,
    conversationId: string,
  ): Promise<boolean>;
  cleanup(cutoff: Date): Promise<number>;
  healthCheck(): Promise<boolean>;
  closeConnection(): Promise<void>;
}
