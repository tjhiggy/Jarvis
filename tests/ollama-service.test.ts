import { describe, expect, it } from 'vitest';
import { OllamaChatService } from '../src/ollama/ollama-service.js';

describe('OllamaChatService', () => {
  it('sends instructions and ordered conversation history to the local chat API', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const service = new OllamaChatService({
      baseUrl: 'http://127.0.0.1:11434/',
      model: 'qwen-test',
      timeoutMs: 1_000,
      maxRetries: 0,
      maxOutputTokens: 321,
      fetch: async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return Response.json({
          model: 'qwen-test',
          created_at: '2026-07-28T12:00:00Z',
          message: { role: 'assistant', content: 'At your service.' },
          done: true,
          done_reason: 'stop',
        });
      },
    });

    await expect(
      service.respond({
        instructions: 'Be precise.',
        history: [
          { role: 'user', content: 'Earlier question' },
          { role: 'assistant', content: 'Earlier answer' },
        ],
        prompt: 'Current question',
        safetyIdentifier: 'not-sent-to-ollama',
      }),
    ).resolves.toEqual({ text: 'At your service.' });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe('http://127.0.0.1:11434/api/chat');
    expect(JSON.parse(String(requests[0]?.init.body))).toEqual({
      model: 'qwen-test',
      messages: [
        { role: 'system', content: 'Be precise.' },
        { role: 'user', content: 'Earlier question' },
        { role: 'assistant', content: 'Earlier answer' },
        { role: 'user', content: 'Current question' },
      ],
      stream: false,
      think: false,
      options: { num_predict: 321 },
    });
  });

  it('maps an unavailable Ollama server to a service error after retries', async () => {
    let attempts = 0;
    const service = new OllamaChatService({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen-test',
      timeoutMs: 1_000,
      maxRetries: 1,
      maxOutputTokens: 321,
      fetch: async () => {
        attempts += 1;
        throw new TypeError('connection refused');
      },
      sleep: async () => undefined,
      jitter: () => 0,
    });

    await expect(service.respond(request())).rejects.toMatchObject({
      code: 'service',
    });
    expect(attempts).toBe(2);
  });

  it('maps a missing local model to a validation error without retrying', async () => {
    let attempts = 0;
    const service = new OllamaChatService({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'missing-model',
      timeoutMs: 1_000,
      maxRetries: 3,
      maxOutputTokens: 321,
      fetch: async () => {
        attempts += 1;
        return Response.json(
          { error: 'model "missing-model" not found' },
          { status: 404 },
        );
      },
      sleep: async () => undefined,
    });

    await expect(service.respond(request())).rejects.toMatchObject({
      code: 'validation',
    });
    expect(attempts).toBe(1);
  });
});

function request() {
  return {
    instructions: 'Be precise.',
    history: [],
    prompt: 'Current question',
    safetyIdentifier: 'local-user',
  } as const;
}
