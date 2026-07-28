import type {
  AIRequest,
  AIResponse,
  AIService,
  ConversationTurn,
} from '../openai/openai-service.js';
import { OpenAIServiceError } from '../openai/openai-errors.js';

interface OllamaChatResponse {
  readonly message?: Readonly<{ role?: string; content?: string }>;
  readonly done?: boolean;
}

export interface OllamaChatServiceOptions {
  readonly baseUrl: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly maxOutputTokens: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly sleep?: (delayMs: number) => Promise<void>;
  readonly jitter?: () => number;
}

const delay = (delayMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

export class OllamaChatService implements AIService {
  private readonly fetch: typeof globalThis.fetch;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly jitter: () => number;

  constructor(private readonly options: OllamaChatServiceOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? delay;
    this.jitter = options.jitter ?? Math.random;
  }

  async respond(request: AIRequest): Promise<AIResponse> {
    for (let retry = 0; ; retry += 1) {
      try {
        return await this.respondOnce(request);
      } catch (error) {
        const mapped = mapError(error);
        if (!mapped.retryable || retry >= this.options.maxRetries) {
          throw mapped;
        }
        const baseDelay = 100 * 2 ** retry;
        await this.sleep(baseDelay + Math.floor(baseDelay * this.jitter()));
      }
    }
  }

  private async respondOnce(request: AIRequest): Promise<AIResponse> {
    const messages: ConversationTurn[] = [
      { role: 'user', content: request.prompt },
    ];
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs,
    );

    try {
      const baseUrl = this.options.baseUrl.replace(/\/+$/, '');
      const response = await this.fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.options.model,
          messages: [
            { role: 'system', content: request.instructions },
            ...request.history,
            ...messages,
          ],
          stream: false,
          think: false,
          options: { num_predict: this.options.maxOutputTokens },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new OllamaHttpError(response.status);
      }

      const result = (await response.json()) as OllamaChatResponse;
      const text = result.message?.content?.trim();
      if (result.done !== true || text === undefined || text === '') {
        throw new OpenAIServiceError('service');
      }
      return { text };
    } finally {
      clearTimeout(timeout);
    }
  }
}

class OllamaHttpError extends Error {
  constructor(readonly status: number) {
    super(`Ollama HTTP error: ${status}`);
    this.name = 'OllamaHttpError';
  }
}

function mapError(error: unknown): OpenAIServiceError {
  if (error instanceof OpenAIServiceError) {
    return error;
  }
  if (
    error instanceof DOMException &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')
  ) {
    return new OpenAIServiceError('timeout', { cause: error });
  }
  if (error instanceof OllamaHttpError) {
    if (error.status === 401 || error.status === 403) {
      return new OpenAIServiceError('authentication', { cause: error });
    }
    if (error.status === 429) {
      return new OpenAIServiceError('rate_limit', {
        cause: error,
        retryable: true,
      });
    }
    if (error.status === 404 || (error.status >= 400 && error.status < 500)) {
      return new OpenAIServiceError('validation', { cause: error });
    }
    return new OpenAIServiceError('service', {
      cause: error,
      retryable: error.status >= 500,
    });
  }
  return new OpenAIServiceError('service', {
    cause: error,
    retryable: error instanceof TypeError,
  });
}
