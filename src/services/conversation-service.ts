import { createHash } from 'node:crypto';
import {
  composeInstructions,
  resolvePersonaMode,
  type TrustedPersona,
} from '../config/persona.js';
import {
  type AIService,
  type ConversationTurn,
} from '../openai/openai-service.js';
import { isAllowedChannel } from '../discord/access.js';
import { EventDeduplicator } from '../security/event-deduplicator.js';
import { RateLimiter } from '../security/rate-limiter.js';
import type {
  ConversationMessage,
  ConversationStore,
} from '../storage/conversation-store.js';
import {
  projectOperationalError,
  type OperationalLogger,
} from '../utils/logger.js';

export interface ConversationRequest {
  readonly eventId: string;
  readonly guildId: string;
  readonly conversationId: string;
  readonly channelId: string;
  readonly parentChannelId?: string;
  readonly userId: string;
  readonly prompt: string;
  readonly isBot?: boolean;
  /** Present on some Discord events, but deliberately never forwarded to AI. */
  readonly username?: string;
}

export interface ConversationClearRequest {
  readonly eventId: string;
  readonly guildId: string;
  readonly conversationId: string;
  readonly channelId: string;
  readonly userId: string;
}

export type ConversationResult =
  | Readonly<{
      status: 'success';
      text: string;
      responseId?: string;
    }>
  | Readonly<{
      status:
        'invalid_input' | 'disallowed' | 'duplicate' | 'forgotten' | 'ai_error';
      message: string;
    }>
  | Readonly<{
      status: 'rate_limited';
      message: string;
      retryAfterMs: number;
    }>;

export interface ConversationServiceOptions {
  readonly store: ConversationStore;
  readonly ai: AIService;
  readonly rateLimiter: RateLimiter;
  readonly deduplicator: EventDeduplicator;
  readonly persona: TrustedPersona;
  readonly allowedChannelIds: ReadonlySet<string>;
  readonly restrainedChannelIds: ReadonlySet<string>;
  readonly maxInputChars: number;
  readonly maxHistoryMessages: number;
  /** A stable operator-controlled application secret, never sent to AI. */
  readonly safetyIdentifierSecret: string;
  readonly now?: () => Date;
  readonly elapsedNow?: () => number;
  readonly logger?: OperationalLogger;
  readonly maxActiveConversations?: number;
}

interface NormalizedRequest {
  readonly eventId: string;
  readonly guildId: string;
  readonly conversationId: string;
  readonly channelId: string;
  readonly parentChannelId?: string;
  readonly userId: string;
  readonly prompt: string;
}

const invalidInputMessage = 'Please provide a valid request.';
const disallowedMessage = 'This channel is not available for requests.';
const duplicateMessage = 'That request has already been handled.';
const rateLimitedMessage = 'Too many requests. Please try again shortly.';
const serviceErrorMessage =
  'The AI service is unavailable. Please try again later.';
const forgottenMessage =
  'This request was cancelled because the conversation was cleared.';
const maxActiveConversationStates = 10_000;
const staleConversation = Symbol('staleConversation');
const noOpLogger: OperationalLogger = {
  info: () => undefined,
  warn: () => undefined,
};

type ConversationContext = Pick<
  NormalizedRequest,
  'eventId' | 'guildId' | 'conversationId' | 'channelId' | 'userId'
>;

type ConversationStage =
  | 'coordination'
  | 'storage_read'
  | 'storage_user_append'
  | 'openai'
  | 'storage_assistant_append';

export class ConversationService {
  private readonly now: () => Date;
  private readonly elapsedNow: () => number;
  private readonly logger: OperationalLogger;
  private readonly coordinator: ConversationCoordinator;

  constructor(private readonly options: ConversationServiceOptions) {
    validateOptions(options);
    this.now = options.now ?? (() => new Date());
    this.elapsedNow = options.elapsedNow ?? (() => performance.now());
    this.logger = options.logger ?? noOpLogger;
    this.coordinator = new ConversationCoordinator(
      options.maxActiveConversations ?? maxActiveConversationStates,
    );
  }

  async ask(request: ConversationRequest): Promise<ConversationResult> {
    const normalized = this.normalize(request);
    if (normalized === undefined) {
      return { status: 'invalid_input', message: invalidInputMessage };
    }

    const context = conversationContext(normalized);
    const startedAt = this.elapsedNow();
    this.logger.info(context, 'Conversation request started.');

    if (
      !isAllowedChannel(
        normalized.channelId,
        normalized.parentChannelId,
        this.options.allowedChannelIds,
      )
    ) {
      this.logCompletion(context, startedAt, 'disallowed');
      return { status: 'disallowed', message: disallowedMessage };
    }

    if (!this.options.deduplicator.accept(normalized.eventId)) {
      this.logCompletion(context, startedAt, 'duplicate');
      return { status: 'duplicate', message: duplicateMessage };
    }

    const rateLimit = this.options.rateLimiter.consume(
      JSON.stringify([normalized.guildId, normalized.userId]),
    );
    if (!rateLimit.allowed) {
      this.options.deduplicator.release(normalized.eventId);
      this.logCompletion(context, startedAt, 'rate_limited');
      return {
        status: 'rate_limited',
        message: rateLimitedMessage,
        retryAfterMs: rateLimit.retryAfterMs,
      };
    }

    let lease: ConversationLease | undefined;
    let stage: ConversationStage = 'coordination';
    try {
      lease = this.coordinator.acquire(
        normalized.guildId,
        normalized.conversationId,
      );
      const history = await lease.runIfCurrent(async () => {
        stage = 'storage_read';
        const storedHistory = await this.options.store.getRecent(
          normalized.guildId,
          normalized.conversationId,
          this.options.maxHistoryMessages,
        );
        const turns = toConversationTurns(
          storedHistory.slice(-this.options.maxHistoryMessages),
        );

        stage = 'storage_user_append';
        await this.options.store.append({
          guildId: normalized.guildId,
          conversationId: normalized.conversationId,
          userId: normalized.userId,
          role: 'user',
          content: normalized.prompt,
          timestamp: this.now(),
        });
        return turns;
      });
      if (history === staleConversation) {
        this.logCompletion(context, startedAt, 'forgotten');
        return { status: 'forgotten', message: forgottenMessage };
      }

      const instructions = composeInstructions(
        this.options.persona,
        resolvePersonaMode({
          channelId: normalized.channelId,
          ...(normalized.parentChannelId === undefined
            ? {}
            : { parentChannelId: normalized.parentChannelId }),
          restrainedChannelIds: this.options.restrainedChannelIds,
        }),
      );

      stage = 'openai';
      const response = await this.options.ai.respond({
        instructions,
        history,
        prompt: normalized.prompt,
        safetyIdentifier: createSafetyIdentifier(
          this.options.safetyIdentifierSecret,
          normalized.guildId,
          normalized.userId,
        ),
      });

      const assistantAppend = await lease.runIfCurrent(async () => {
        stage = 'storage_assistant_append';
        await this.options.store.append({
          guildId: normalized.guildId,
          conversationId: normalized.conversationId,
          userId: normalized.userId,
          role: 'assistant',
          content: response.text,
          timestamp: this.now(),
          ...(response.responseId === undefined
            ? {}
            : { openaiResponseId: response.responseId }),
        });
      });
      if (assistantAppend === staleConversation) {
        this.logCompletion(context, startedAt, 'forgotten');
        return { status: 'forgotten', message: forgottenMessage };
      }

      this.logCompletion(context, startedAt, 'success');
      return {
        status: 'success',
        text: response.text,
        ...(response.responseId === undefined
          ? {}
          : { responseId: response.responseId }),
      };
    } catch (error) {
      this.options.deduplicator.release(normalized.eventId);
      this.logger.warn(
        {
          ...context,
          elapsedMs: elapsedMilliseconds(startedAt, this.elapsedNow()),
          outcome: 'ai_error',
          stage,
          ...projectOperationalError(error, errorCategory(stage)),
        },
        'Conversation request failed.',
      );
      return { status: 'ai_error', message: serviceErrorMessage };
    } finally {
      lease?.release();
    }
  }

  async clear(request: ConversationClearRequest): Promise<number> {
    const normalized = normalizeClearRequest(request);
    const context = conversationContext(normalized);
    const startedAt = this.elapsedNow();
    this.logger.info(context, 'Conversation clear started.');
    if (!this.options.deduplicator.accept(normalized.eventId)) {
      this.logCompletion(context, startedAt, 'duplicate_clear');
      return 0;
    }

    let lease: ConversationLease | undefined;
    let stage = 'coordination';
    try {
      lease = this.coordinator.acquire(
        normalized.guildId,
        normalized.conversationId,
      );
      const deleted = await lease.invalidateAfter(async () => {
        stage = 'storage_clear';
        return this.options.store.clear(
          normalized.guildId,
          normalized.conversationId,
        );
      });
      this.logCompletion(context, startedAt, 'cleared');
      return deleted;
    } catch (error) {
      this.options.deduplicator.release(normalized.eventId);
      this.logger.warn(
        {
          ...context,
          elapsedMs: elapsedMilliseconds(startedAt, this.elapsedNow()),
          outcome: 'clear_error',
          stage,
          ...projectOperationalError(
            error,
            stage === 'coordination' ? 'coordination' : 'storage',
          ),
        },
        'Conversation clear failed.',
      );
      throw error;
    } finally {
      lease?.release();
    }
  }

  private logCompletion(
    context: ConversationContext,
    startedAt: number,
    outcome: string,
  ): void {
    this.logger.info(
      {
        ...context,
        elapsedMs: elapsedMilliseconds(startedAt, this.elapsedNow()),
        outcome,
      },
      'Conversation request completed.',
    );
  }

  private normalize(
    request: ConversationRequest,
  ): NormalizedRequest | undefined {
    if (request.isBot === true) {
      return undefined;
    }

    const eventId = request.eventId.trim();
    const guildId = request.guildId.trim();
    const conversationId = request.conversationId.trim();
    const channelId = request.channelId.trim();
    const userId = request.userId.trim();
    const prompt = request.prompt.trim();
    const parentChannelId = request.parentChannelId?.trim();

    if (
      eventId === '' ||
      guildId === '' ||
      conversationId === '' ||
      channelId === '' ||
      userId === '' ||
      prompt === '' ||
      Array.from(prompt).length > this.options.maxInputChars
    ) {
      return undefined;
    }

    return {
      eventId,
      guildId,
      conversationId,
      channelId,
      userId,
      prompt,
      ...(parentChannelId === undefined || parentChannelId === ''
        ? {}
        : { parentChannelId }),
    };
  }
}

interface ConversationState {
  epoch: number;
  references: number;
  tail: Promise<void>;
}

interface ConversationLease {
  runIfCurrent<T>(
    action: () => Promise<T>,
  ): Promise<T | typeof staleConversation>;
  invalidateAfter<T>(action: () => Promise<T>): Promise<T>;
  release(): void;
}

class ConversationCoordinator {
  private readonly states = new Map<string, ConversationState>();

  constructor(private readonly maximumStates: number) {}

  acquire(guildId: string, conversationId: string): ConversationLease {
    const key = JSON.stringify([guildId, conversationId]);
    let state = this.states.get(key);
    if (state === undefined) {
      if (this.states.size >= this.maximumStates) {
        throw Object.assign(new Error('Conversation capacity reached.'), {
          code: 'CONVERSATION_CAPACITY',
        });
      }
      state = { epoch: 0, references: 0, tail: Promise.resolve() };
      this.states.set(key, state);
    }
    state.references += 1;
    const acquiredState = state;
    const acquiredEpoch = state.epoch;
    let released = false;

    const runExclusive = async <T>(action: () => Promise<T>): Promise<T> => {
      const predecessor = acquiredState.tail;
      let releaseGate: (() => void) | undefined;
      acquiredState.tail = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
      await predecessor;
      try {
        return await action();
      } finally {
        releaseGate?.();
      }
    };

    return {
      runIfCurrent: (action) =>
        runExclusive(async () => {
          if (acquiredState.epoch !== acquiredEpoch) {
            return staleConversation;
          }
          return action();
        }),
      invalidateAfter: (action) =>
        runExclusive(async () => {
          const result = await action();
          acquiredState.epoch += 1;
          return result;
        }),
      release: () => {
        if (released) {
          return;
        }
        released = true;
        acquiredState.references -= 1;
        if (
          acquiredState.references === 0 &&
          this.states.get(key) === acquiredState
        ) {
          this.states.delete(key);
        }
      },
    };
  }
}

export function createSafetyIdentifier(
  applicationSecret: string,
  guildId: string,
  userId: string,
): string {
  return createHash('sha256')
    .update(JSON.stringify([applicationSecret, guildId, userId]))
    .digest('hex');
}

function toConversationTurns(
  messages: readonly ConversationMessage[],
): ConversationTurn[] {
  return messages.map(({ role, content }) => ({ role, content }));
}

function validateOptions(options: ConversationServiceOptions): void {
  if (
    !Number.isSafeInteger(options.maxInputChars) ||
    !Number.isSafeInteger(options.maxHistoryMessages) ||
    options.maxInputChars < 1 ||
    options.maxHistoryMessages < 1 ||
    (options.maxActiveConversations !== undefined &&
      (!Number.isSafeInteger(options.maxActiveConversations) ||
        options.maxActiveConversations < 1)) ||
    options.safetyIdentifierSecret.trim() === ''
  ) {
    throw new RangeError(
      'Conversation service limits must be positive safe integers and the safety secret must not be empty.',
    );
  }
}

function normalizeClearRequest(
  request: ConversationClearRequest,
): ConversationClearRequest {
  const normalized = {
    eventId: request.eventId.trim(),
    guildId: request.guildId.trim(),
    conversationId: request.conversationId.trim(),
    channelId: request.channelId.trim(),
    userId: request.userId.trim(),
  };
  if (Object.values(normalized).some((value) => value === '')) {
    throw new TypeError('Conversation clear identifiers must not be empty.');
  }
  return normalized;
}

function conversationContext(
  request: ConversationContext,
): ConversationContext {
  return {
    eventId: request.eventId,
    guildId: request.guildId,
    conversationId: request.conversationId,
    channelId: request.channelId,
    userId: request.userId,
  };
}

function elapsedMilliseconds(startedAt: number, finishedAt: number): number {
  const elapsed = finishedAt - startedAt;
  return Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : 0;
}

function errorCategory(stage: ConversationStage): string {
  if (stage === 'openai') {
    return 'openai';
  }
  return stage.startsWith('storage') ? 'storage' : 'coordination';
}
