export type OpenAIErrorCode =
  'authentication' | 'quota' | 'rate_limit' | 'safety' | 'timeout' | 'service';

export class OpenAIServiceError extends Error {
  readonly code: OpenAIErrorCode;

  constructor(code: OpenAIErrorCode, options?: ErrorOptions) {
    super(`OpenAI service error: ${code}`, options);
    this.name = 'OpenAIServiceError';
    this.code = code;
  }
}
