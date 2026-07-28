export type OpenAIErrorCode =
  | 'authentication'
  | 'quota'
  | 'rate_limit'
  | 'safety'
  | 'timeout'
  | 'validation'
  | 'output_limit'
  | 'service';

interface OpenAIServiceErrorOptions extends ErrorOptions {
  readonly retryable?: boolean;
}

export class OpenAIServiceError extends Error {
  readonly code: OpenAIErrorCode;
  readonly retryable: boolean;

  constructor(code: OpenAIErrorCode, options?: OpenAIServiceErrorOptions) {
    super(
      `OpenAI service error: ${code}`,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'OpenAIServiceError';
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}
