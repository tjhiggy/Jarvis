import { createHash } from 'node:crypto';
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
} from 'openai';
import { describe, expect, it, vi } from 'vitest';
import { OpenAIServiceError } from '../src/openai/openai-errors.js';
import { OpenAIResponsesService } from '../src/openai/openai-service.js';

describe('OpenAIResponsesService', () => {
  it('sends an ordered private Responses request and returns the response text', async () => {
    const requests: unknown[] = [];
    const requestOptions: unknown[] = [];
    const service = new OpenAIResponsesService({
      client: {
        responses: {
          create: async (request, options) => {
            requests.push(request);
            requestOptions.push(options);
            return { id: 'resp_123', output_text: 'At your service.' };
          },
        },
      },
      model: 'gpt-test',
      timeoutMs: 1_000,
      maxRetries: 0,
      maxOutputTokens: 321,
    });

    await expect(
      service.respond({
        instructions: 'Be precise.',
        history: [
          { role: 'user', content: 'Earlier question' },
          { role: 'assistant', content: 'Earlier answer' },
        ],
        prompt: 'Current question',
        safetyIdentifier: 'guild-7:user-9',
      }),
    ).resolves.toEqual({ text: 'At your service.', responseId: 'resp_123' });

    expect(requests).toEqual([
      {
        model: 'gpt-test',
        instructions: 'Be precise.',
        input: [
          { role: 'user', content: 'Earlier question' },
          { role: 'assistant', content: 'Earlier answer' },
          { role: 'user', content: 'Current question' },
        ],
        max_output_tokens: 321,
        store: false,
        safety_identifier: createHash('sha256')
          .update('guild-7:user-9')
          .digest('hex'),
      },
    ]);
    expect(requestOptions).toEqual([
      { signal: expect.any(AbortSignal), maxRetries: 0 },
    ]);
  });

  it('rejects an empty model output as a service error', async () => {
    const service = new OpenAIResponsesService({
      client: {
        responses: {
          create: async () => ({ id: 'resp_empty', output_text: '' }),
        },
      },
      model: 'gpt-test',
      timeoutMs: 1_000,
      maxRetries: 0,
      maxOutputTokens: 321,
    });

    await expect(service.respond(request())).rejects.toMatchObject({
      code: 'service',
    } satisfies Partial<OpenAIServiceError>);
  });

  it('maps a 401 SDK response to an authentication error', async () => {
    const service = new OpenAIResponsesService({
      client: {
        responses: {
          create: async () => {
            throw { status: 401, code: 'invalid_api_key' };
          },
        },
      },
      model: 'gpt-test',
      timeoutMs: 1_000,
      maxRetries: 0,
      maxOutputTokens: 321,
    });

    await expect(service.respond(request())).rejects.toMatchObject({
      code: 'authentication',
    } satisfies Partial<OpenAIServiceError>);
  });

  it.each([
    [{ status: 429, code: 'insufficient_quota' }, 'quota'],
    [{ status: 429, code: 'rate_limit_exceeded' }, 'rate_limit'],
    [{ status: 400, code: 'safety_violation' }, 'safety'],
    [{ status: 403, code: 'moderation_blocked' }, 'safety'],
    [new DOMException('The request expired.', 'AbortError'), 'timeout'],
  ] as const)('maps SDK failures to %s errors', async (sdkError, code) => {
    const service = new OpenAIResponsesService({
      client: {
        responses: {
          create: async () => {
            throw sdkError;
          },
        },
      },
      model: 'gpt-test',
      timeoutMs: 1_000,
      maxRetries: 0,
      maxOutputTokens: 321,
    });

    await expect(service.respond(request())).rejects.toMatchObject({
      code,
    } satisfies Partial<OpenAIServiceError>);
  });

  it('retries a transient server failure before returning a later response', async () => {
    let attempts = 0;
    const delays: number[] = [];
    const service = new OpenAIResponsesService({
      client: {
        responses: {
          create: async () => {
            attempts += 1;
            if (attempts === 1) {
              throw { status: 500, code: 'server_error' };
            }

            return { id: 'resp_recovered', output_text: 'Recovered.' };
          },
        },
      },
      model: 'gpt-test',
      timeoutMs: 1_000,
      maxRetries: 1,
      maxOutputTokens: 321,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
      jitter: () => 0,
    });

    await expect(service.respond(request())).resolves.toEqual({
      text: 'Recovered.',
      responseId: 'resp_recovered',
    });
    expect(attempts).toBe(2);
    expect(delays).toEqual([100]);
  });

  it('waits for the default exponential delay before retrying', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const service = new OpenAIResponsesService({
      client: {
        responses: {
          create: async () => {
            attempts += 1;
            if (attempts === 1) {
              throw { status: 500, code: 'server_error' };
            }

            return { id: 'resp_delayed', output_text: 'Eventually.' };
          },
        },
      },
      model: 'gpt-test',
      timeoutMs: 1_000,
      maxRetries: 1,
      maxOutputTokens: 321,
      jitter: () => 0,
    });

    try {
      const response = service.respond(request());

      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toBe(1);

      await vi.advanceTimersByTimeAsync(100);
      await expect(response).resolves.toEqual({
        text: 'Eventually.',
        responseId: 'resp_delayed',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    [{ status: 408, code: 'request_timeout' }, 'service'],
    [{ status: 409, code: 'conflict' }, 'service'],
    [{ status: 429, code: 'rate_limit_exceeded' }, 'rate_limit'],
    [
      new APIConnectionError({
        cause: new TypeError('network connection failed'),
      }),
      'service',
    ],
  ] as const)(
    'retries transient %s failures before reporting %s',
    async (sdkError, code) => {
      let attempts = 0;
      const delays: number[] = [];
      const service = new OpenAIResponsesService({
        client: {
          responses: {
            create: async () => {
              attempts += 1;
              throw sdkError;
            },
          },
        },
        model: 'gpt-test',
        timeoutMs: 1_000,
        maxRetries: 1,
        maxOutputTokens: 321,
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
        jitter: () => 0,
      });

      await expect(service.respond(request())).rejects.toMatchObject({
        code,
      } satisfies Partial<OpenAIServiceError>);
      expect(attempts).toBe(2);
      expect(delays).toEqual([100]);
    },
  );

  it.each([
    [{ status: 401, code: 'invalid_api_key' }, 'authentication'],
    [{ status: 400, code: 'safety_violation' }, 'safety'],
    [{ status: 429, code: 'insufficient_quota' }, 'quota'],
    [new TypeError('permanent client misuse'), 'service'],
  ] as const)(
    'does not retry a permanent %s failure',
    async (sdkError, code) => {
      let attempts = 0;
      const delays: number[] = [];
      const service = new OpenAIResponsesService({
        client: {
          responses: {
            create: async () => {
              attempts += 1;
              throw sdkError;
            },
          },
        },
        model: 'gpt-test',
        timeoutMs: 1_000,
        maxRetries: 3,
        maxOutputTokens: 321,
        sleep: async (delayMs) => {
          delays.push(delayMs);
        },
        jitter: () => 0,
      });

      await expect(service.respond(request())).rejects.toMatchObject({
        code,
      } satisfies Partial<OpenAIServiceError>);
      expect(attempts).toBe(1);
      expect(delays).toEqual([]);
    },
  );

  it('stops after the configured number of retries for a persistent transient error', async () => {
    let attempts = 0;
    const delays: number[] = [];
    const service = new OpenAIResponsesService({
      client: {
        responses: {
          create: async () => {
            attempts += 1;
            throw { status: 503, code: 'server_error' };
          },
        },
      },
      model: 'gpt-test',
      timeoutMs: 1_000,
      maxRetries: 2,
      maxOutputTokens: 321,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
      jitter: () => 0,
    });

    await expect(service.respond(request())).rejects.toMatchObject({
      code: 'service',
    } satisfies Partial<OpenAIServiceError>);
    expect(attempts).toBe(3);
    expect(delays).toEqual([100, 200]);
  });

  it('aborts a timed out attempt and clears its timer', async () => {
    let timeoutCallback: (() => void) | undefined;
    const cleared: unknown[] = [];
    const service = new OpenAIResponsesService({
      client: {
        responses: {
          create: async (_request, { signal }) => {
            timeoutCallback?.();
            expect(signal.aborted).toBe(true);
            throw new DOMException('The request expired.', 'AbortError');
          },
        },
      },
      model: 'gpt-test',
      timeoutMs: 500,
      maxRetries: 3,
      maxOutputTokens: 321,
      timer: {
        setTimeout: (callback) => {
          timeoutCallback = callback;
          return 'request-timeout';
        },
        clearTimeout: (handle) => {
          cleared.push(handle);
        },
      },
    });

    await expect(service.respond(request())).rejects.toMatchObject({
      code: 'timeout',
    } satisfies Partial<OpenAIServiceError>);
    expect(cleared).toEqual(['request-timeout']);
  });

  it('maps an APIUserAbortError-like rejection after its own abort to timeout without retrying', async () => {
    let timeoutCallback: (() => void) | undefined;
    let attempts = 0;
    const delays: number[] = [];
    const service = new OpenAIResponsesService({
      client: {
        responses: {
          create: async (_request, { signal }) => {
            attempts += 1;
            timeoutCallback?.();
            expect(signal.aborted).toBe(true);
            throw Object.assign(new Error('Request was aborted.'), {
              name: 'APIUserAbortError',
            });
          },
        },
      },
      model: 'gpt-test',
      timeoutMs: 500,
      maxRetries: 3,
      maxOutputTokens: 321,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
      timer: {
        setTimeout: (callback) => {
          timeoutCallback = callback;
          return 'request-timeout';
        },
        clearTimeout: () => undefined,
      },
    });

    await expect(service.respond(request())).rejects.toMatchObject({
      code: 'timeout',
    } satisfies Partial<OpenAIServiceError>);
    expect(attempts).toBe(1);
    expect(delays).toEqual([]);
  });

  it('maps an SDK connection-timeout error to timeout without retrying', async () => {
    let attempts = 0;
    const delays: number[] = [];
    const service = new OpenAIResponsesService({
      client: {
        responses: {
          create: async () => {
            attempts += 1;
            throw new APIConnectionTimeoutError();
          },
        },
      },
      model: 'gpt-test',
      timeoutMs: 500,
      maxRetries: 3,
      maxOutputTokens: 321,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    });

    await expect(service.respond(request())).rejects.toMatchObject({
      code: 'timeout',
    } satisfies Partial<OpenAIServiceError>);
    expect(attempts).toBe(1);
    expect(delays).toEqual([]);
  });

  it('maps an SDK user-abort error to timeout without retrying', async () => {
    let attempts = 0;
    const delays: number[] = [];
    const service = new OpenAIResponsesService({
      client: {
        responses: {
          create: async () => {
            attempts += 1;
            throw new APIUserAbortError();
          },
        },
      },
      model: 'gpt-test',
      timeoutMs: 500,
      maxRetries: 3,
      maxOutputTokens: 321,
      sleep: async (delayMs) => {
        delays.push(delayMs);
      },
    });

    await expect(service.respond(request())).rejects.toMatchObject({
      code: 'timeout',
    } satisfies Partial<OpenAIServiceError>);
    expect(attempts).toBe(1);
    expect(delays).toEqual([]);
  });

  it('clears the individual timer created for each retry attempt', async () => {
    let attempts = 0;
    const cleared: unknown[] = [];
    const service = new OpenAIResponsesService({
      client: {
        responses: {
          create: async () => {
            attempts += 1;
            if (attempts === 1) {
              throw { status: 500, code: 'server_error' };
            }

            return { id: 'resp_retried', output_text: 'Done.' };
          },
        },
      },
      model: 'gpt-test',
      timeoutMs: 1_000,
      maxRetries: 1,
      maxOutputTokens: 321,
      sleep: async () => undefined,
      jitter: () => 0,
      timer: {
        setTimeout: () => attempts + 1,
        clearTimeout: (handle) => {
          cleared.push(handle);
        },
      },
    });

    await expect(service.respond(request())).resolves.toEqual({
      text: 'Done.',
      responseId: 'resp_retried',
    });
    expect(cleared).toEqual([1, 2]);
  });
});

function request() {
  return {
    instructions: 'Be precise.',
    history: [],
    prompt: 'Current question',
    safetyIdentifier: 'guild-7:user-9',
  } as const;
}
