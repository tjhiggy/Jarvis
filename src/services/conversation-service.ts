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

export type ConversationResult =
  | Readonly<{
      status: 'success';
      text: string;
      responseId?: string;
    }>
  | Readonly<{
      status: 'invalid_input' | 'disallowed' | 'duplicate' | 'ai_error';
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

export class ConversationService {
  private readonly now: () => Date;

  constructor(private readonly options: ConversationServiceOptions) {
    validateOptions(options);
    this.now = options.now ?? (() => new Date());
  }

  async ask(request: ConversationRequest): Promise<ConversationResult> {
    const normalized = this.normalize(request);
    if (normalized === undefined) {
      return { status: 'invalid_input', message: invalidInputMessage };
    }

    if (
      !isAllowedChannel(
        normalized.channelId,
        normalized.parentChannelId,
        this.options.allowedChannelIds,
      )
    ) {
      return { status: 'disallowed', message: disallowedMessage };
    }

    if (!this.options.deduplicator.accept(normalized.eventId)) {
      return { status: 'duplicate', message: duplicateMessage };
    }

    const rateLimit = this.options.rateLimiter.consume(
      JSON.stringify([normalized.guildId, normalized.userId]),
    );
    if (!rateLimit.allowed) {
      this.options.deduplicator.release(normalized.eventId);
      return {
        status: 'rate_limited',
        message: rateLimitedMessage,
        retryAfterMs: rateLimit.retryAfterMs,
      };
    }

    try {
      const storedHistory = await this.options.store.getRecent(
        normalized.guildId,
        normalized.conversationId,
        this.options.maxHistoryMessages,
      );
      const history = toConversationTurns(
        storedHistory.slice(-this.options.maxHistoryMessages),
      );
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

      await this.options.store.append({
        guildId: normalized.guildId,
        conversationId: normalized.conversationId,
        userId: normalized.userId,
        role: 'user',
        content: normalized.prompt,
        timestamp: this.now(),
      });

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

      return {
        status: 'success',
        text: response.text,
        ...(response.responseId === undefined
          ? {}
          : { responseId: response.responseId }),
      };
    } catch {
      this.options.deduplicator.release(normalized.eventId);
      return { status: 'ai_error', message: serviceErrorMessage };
    }
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
    options.safetyIdentifierSecret.trim() === ''
  ) {
    throw new RangeError(
      'Conversation service limits must be positive safe integers and the safety secret must not be empty.',
    );
  }
}
