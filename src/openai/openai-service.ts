import { createHash } from 'node:crypto';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
} from 'openai';
import type {
  Response,
  ResponseError,
} from 'openai/resources/responses/responses.js';
import { OpenAIServiceError } from './openai-errors.js';

export interface ConversationTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface AIRequest {
  readonly instructions: string;
  readonly history: readonly ConversationTurn[];
  readonly prompt: string;
  readonly safetyIdentifier: string;
}

export interface AIResponse {
  readonly text: string;
  readonly responseId?: string;
}

export interface AIService {
  respond(request: AIRequest): Promise<AIResponse>;
}

export interface ResponsesRequest {
  readonly model: string;
  readonly instructions: string;
  readonly input: ConversationTurn[];
  readonly max_output_tokens: number;
  readonly store: false;
  readonly safety_identifier: string;
}

export interface OpenAIResponsesClient {
  readonly responses: Readonly<{
    create(
      request: ResponsesRequest,
      options: Readonly<{ signal: AbortSignal; maxRetries: 0 }>,
    ): Promise<Response>;
  }>;
}

interface Timer {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface OpenAIResponsesServiceOptions {
  readonly client: OpenAIResponsesClient;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly maxOutputTokens: number;
  readonly timer?: Timer;
  readonly sleep?: (delayMs: number) => Promise<void>;
  readonly jitter?: () => number;
}

const systemTimer: Timer = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

const delay = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

export class OpenAIResponsesService implements AIService {
  private readonly timer: Timer;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly jitter: () => number;

  constructor(private readonly options: OpenAIResponsesServiceOptions) {
    this.timer = options.timer ?? systemTimer;
    this.sleep = options.sleep ?? delay;
    this.jitter = options.jitter ?? Math.random;
  }

  async respond(request: AIRequest): Promise<AIResponse> {
    for (let retry = 0; ; retry += 1) {
      try {
        return await this.respondOnce(request);
      } catch (error) {
        if (!isRetryable(error) || retry >= this.options.maxRetries) {
          throw mapError(error);
        }

        await this.sleep(this.retryDelay(retry));
      }
    }
  }

  private async respondOnce(request: AIRequest): Promise<AIResponse> {
    const controller = new AbortController();
    const timeout = this.timer.setTimeout(
      () => controller.abort(),
      this.options.timeoutMs,
    );

    try {
      const response = await this.options.client.responses.create(
        {
          model: this.options.model,
          instructions: request.instructions,
          input: [
            ...request.history,
            { role: 'user', content: request.prompt },
          ],
          max_output_tokens: this.options.maxOutputTokens,
          store: false,
          safety_identifier: createHash('sha256')
            .update(request.safetyIdentifier)
            .digest('hex'),
        },
        { signal: controller.signal, maxRetries: 0 },
      );

      if (
        response.status !== 'completed' ||
        response.error !== null ||
        response.incomplete_details !== null
      ) {
        throw mapTerminalResponse(response);
      }

      if (response.output_text.trim() === '') {
        throw new OpenAIServiceError('service');
      }

      return { text: response.output_text, responseId: response.id };
    } catch (error) {
      if (
        controller.signal.aborted ||
        error instanceof APIUserAbortError ||
        error instanceof APIConnectionTimeoutError
      ) {
        throw new OpenAIServiceError('timeout', { cause: error });
      }

      throw error;
    } finally {
      this.timer.clearTimeout(timeout);
    }
  }

  private retryDelay(retry: number): number {
    const baseDelay = 100 * 2 ** retry;
    return baseDelay + Math.floor(baseDelay * this.jitter());
  }
}

function mapError(error: unknown): OpenAIServiceError {
  if (error instanceof OpenAIServiceError) {
    return error;
  }

  if (getStatus(error) === 401) {
    return new OpenAIServiceError('authentication', { cause: error });
  }

  const status = getStatus(error);
  const code = getCode(error);
  if (status === 429) {
    return new OpenAIServiceError(
      code === 'insufficient_quota' ? 'quota' : 'rate_limit',
      { cause: error },
    );
  }

  if (
    (status === 400 || status === 403) &&
    code !== undefined &&
    /safety|moderation/i.test(code)
  ) {
    return new OpenAIServiceError('safety', { cause: error });
  }

  if (getName(error) === 'AbortError') {
    return new OpenAIServiceError('timeout', { cause: error });
  }

  return new OpenAIServiceError('service', { cause: error });
}

function isRetryable(error: unknown): boolean {
  if (error instanceof OpenAIServiceError) {
    return error.retryable;
  }

  if (getName(error) === 'AbortError') {
    return false;
  }

  const status = getStatus(error);
  if (status === undefined) {
    return error instanceof APIConnectionError;
  }

  if (status === 429) {
    return getCode(error) !== 'insufficient_quota';
  }

  return status === 408 || status === 409 || status >= 500;
}

function mapTerminalResponse(response: Response): OpenAIServiceError {
  if (response.status === 'incomplete') {
    return response.incomplete_details?.reason === 'content_filter'
      ? new OpenAIServiceError('safety')
      : response.incomplete_details?.reason === 'max_output_tokens'
        ? new OpenAIServiceError('output_limit')
        : new OpenAIServiceError('service');
  }

  if (response.error !== null) {
    return mapResponseError(response.error);
  }

  return new OpenAIServiceError('service', {
    retryable:
      response.status === 'failed' ||
      response.status === 'in_progress' ||
      response.status === 'queued',
  });
}

function mapResponseError(error: ResponseError): OpenAIServiceError {
  switch (error.code) {
    case 'server_error':
    case 'vector_store_timeout':
      return new OpenAIServiceError('service', { retryable: true });
    case 'rate_limit_exceeded':
      return new OpenAIServiceError('rate_limit', { retryable: true });
    case 'bio_policy':
    case 'image_content_policy_violation':
      return new OpenAIServiceError('safety');
    default:
      return new OpenAIServiceError('validation');
  }
}

function getStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) {
    return undefined;
  }

  return typeof error.status === 'number' ? error.status : undefined;
}

function getCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  return typeof error.code === 'string' ? error.code : undefined;
}

function getName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('name' in error)) {
    return undefined;
  }

  return typeof error.name === 'string' ? error.name : undefined;
}
