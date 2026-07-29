import {
  PollMessageGatewayError,
  type PollCreationTarget,
  type PollMessageGateway,
} from './poll-message-gateway.js';
import {
  type ClosePollRequest,
  type CreatePollRequest,
  type PollService,
  type PollServiceErrorCode,
  type VoteRequest,
  PollServiceError,
} from './poll-service.js';
import type { PollView } from './poll-types.js';
import {
  projectOperationalError,
  type OperationalLogger,
} from '../utils/logger.js';

export interface PollCreateInteractionRequest extends CreatePollRequest {
  readonly target: PollCreationTarget;
}

export interface PollVoteInteractionRequest extends VoteRequest {
  readonly acknowledge: (message: string) => Promise<unknown>;
}

export interface PollCloseInteractionRequest extends ClosePollRequest {
  readonly acknowledge: (message: string) => Promise<unknown>;
}

export interface PollController {
  create(request: PollCreateInteractionRequest): Promise<void>;
  vote(request: PollVoteInteractionRequest): Promise<void>;
  close(request: PollCloseInteractionRequest): Promise<void>;
  synchronize(poll: PollView): Promise<void>;
}

export interface PollControllerDependencies {
  readonly service: PollService;
  readonly gateway: PollMessageGateway;
  readonly now?: () => Date;
  readonly logger?: OperationalLogger;
}

const retryDelaysMs = [30, 60, 120, 240, 480].map((seconds) => seconds * 1_000);

const noOpLogger: OperationalLogger = {
  info: () => undefined,
  warn: () => undefined,
};

export class DiscordPollController implements PollController {
  private readonly now: () => Date;
  private readonly logger: OperationalLogger;

  constructor(private readonly dependencies: PollControllerDependencies) {
    this.now = dependencies.now ?? (() => new Date());
    this.logger = dependencies.logger ?? noOpLogger;
  }

  async create(request: PollCreateInteractionRequest): Promise<void> {
    let reserved: PollView | undefined;
    try {
      reserved = await this.dependencies.service.reserve(request);
      const messageId = await this.dependencies.gateway.create(
        request.target,
        reserved,
      );
      let active: PollView;
      try {
        active = await this.dependencies.service.activate(
          reserved.id,
          messageId,
        );
      } catch (error) {
        await this.failActivation(reserved, messageId, error);
        return;
      }
      this.log('poll_create', 'success', { pollId: active.id });
    } catch (error) {
      if (reserved !== undefined) {
        await this.failReservation(reserved.id, error);
      }
      this.logFailure('poll_create', error, {
        ...(reserved === undefined ? {} : { pollId: reserved.id }),
      });
      throw error;
    }
  }

  async vote(request: PollVoteInteractionRequest): Promise<void> {
    try {
      const result = await this.dependencies.service.vote(request);
      await request.acknowledge(voteAcknowledgement(result.kind));
      await this.synchronize(result.poll);
      this.log('poll_vote', result.kind, { pollId: result.poll.id });
    } catch (error) {
      await request.acknowledge(voteErrorMessage(error));
      this.logFailure('poll_vote', error, { pollId: request.pollId.trim() });
    }
  }

  async close(request: PollCloseInteractionRequest): Promise<void> {
    try {
      const poll = await this.dependencies.service.close(request);
      await this.synchronize(poll);
      await request.acknowledge(
        'Poll closed. Final results are now displayed.',
      );
      this.log('poll_close', 'success', { pollId: poll.id });
    } catch (error) {
      await request.acknowledge(closeErrorMessage(error));
      this.logFailure('poll_close', error, { pollId: request.pollId.trim() });
    }
  }

  async synchronize(poll: PollView): Promise<void> {
    try {
      await this.dependencies.gateway.update(poll);
      await this.dependencies.service.markSynced(poll.id);
      this.log('poll_sync', 'synced', { pollId: poll.id });
    } catch (error) {
      if (isUnknownMessage(error)) {
        await this.safeMarkOrphaned(poll.id, error);
        return;
      }
      if (poll.syncAttempts >= retryDelaysMs.length) {
        await this.safeMarkOrphaned(poll.id, error);
        return;
      }
      const delay = retryDelaysMs[poll.syncAttempts]!;
      const retryAt = validNow(this.now());
      retryAt.setTime(retryAt.getTime() + delay);
      try {
        await this.dependencies.service.markPendingSync(poll.id, retryAt);
        this.log('poll_sync', 'pending', {
          pollId: poll.id,
          retryDelaySeconds: delay / 1_000,
        });
      } catch (markError) {
        this.logFailure('poll_sync', markError, { pollId: poll.id });
      }
      this.logFailure('poll_sync', error, { pollId: poll.id });
    }
  }

  private async failReservation(pollId: string, cause: unknown): Promise<void> {
    try {
      await this.dependencies.service.fail(pollId);
    } catch (error) {
      this.logFailure('poll_fail', error, { pollId });
    }
    this.logFailure('poll_fail', cause, { pollId });
  }

  private async failActivation(
    reserved: PollView,
    messageId: string,
    cause: unknown,
  ): Promise<void> {
    const published: PollView = { ...reserved, messageId };
    try {
      await this.dependencies.gateway.markUnavailable(published);
    } catch (error) {
      this.logFailure('poll_unavailable', error, { pollId: reserved.id });
    }
    await this.failReservation(reserved.id, cause);
  }

  private async safeMarkOrphaned(
    pollId: string,
    cause: unknown,
  ): Promise<void> {
    try {
      await this.dependencies.service.markOrphaned(pollId);
      this.log('poll_sync', 'orphaned', { pollId });
    } catch (error) {
      this.logFailure('poll_sync', error, { pollId });
    }
    this.logFailure('poll_sync', cause, { pollId });
  }

  private log(
    operation: string,
    outcome: string,
    context: Readonly<Record<string, string | number>>,
  ): void {
    this.logger.info(
      { operation, outcome, ...context },
      'Poll operation completed.',
    );
  }

  private logFailure(
    operation: string,
    error: unknown,
    context: Readonly<Record<string, string | number>>,
  ): void {
    this.logger.warn(
      {
        operation,
        ...context,
        ...projectOperationalError(error, 'poll'),
      },
      'Poll operation failed.',
    );
  }
}

function validNow(value: Date): Date {
  if (!Number.isFinite(value.getTime())) {
    return new Date();
  }
  return new Date(value.getTime());
}

function isUnknownMessage(error: unknown): boolean {
  return (
    error instanceof PollMessageGatewayError &&
    error.category === 'unknown-message'
  );
}

function voteAcknowledgement(
  kind: 'recorded' | 'changed' | 'unchanged',
): string {
  if (kind === 'changed') {
    return 'Vote updated. Live totals are refreshing.';
  }
  if (kind === 'unchanged') {
    return 'Your vote is already recorded for that option.';
  }
  return 'Vote recorded. Live totals are refreshing.';
}

function voteErrorMessage(error: unknown): string {
  const code = serviceErrorCode(error);
  if (code === 'poll_closed') {
    return 'This poll is closed.';
  }
  if (code === 'invalid_option' || code === 'invalid_request') {
    return 'That poll option is not available.';
  }
  return 'The vote could not be recorded. Please try again later.';
}

function closeErrorMessage(error: unknown): string {
  return serviceErrorCode(error) === 'not_found'
    ? 'That poll could not be found.'
    : 'The poll could not be closed. Please try again later.';
}

function serviceErrorCode(error: unknown): PollServiceErrorCode | undefined {
  return error instanceof PollServiceError ? error.code : undefined;
}
