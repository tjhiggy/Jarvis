import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../src/utils/logger.js';

describe('createLogger', () => {
  it('redacts secret fields including nested authorization headers', () => {
    const output = new PassThrough();
    let written = '';
    output.on('data', (chunk: Buffer) => {
      written += chunk.toString('utf8');
    });

    const logger = createLogger('info', output);
    logger.info({
      token: 'discord-token',
      apiKey: 'openai-key',
      request: {
        headers: {
          authorization: 'Bearer lower-case',
          Authorization: 'Bearer upper-case',
          'x-api-key': 'not-a-configured-field',
        },
      },
    });

    expect(written).not.toContain('discord-token');
    expect(written).not.toContain('openai-key');
    expect(written).not.toContain('Bearer lower-case');
    expect(written).not.toContain('Bearer upper-case');
    expect(written).toContain('[REDACTED]');
  });

  it('projects nested errors without their message, stack, content, or secrets', () => {
    const output = new PassThrough();
    let written = '';
    output.on('data', (chunk: Buffer) => {
      written += chunk.toString('utf8');
    });

    const error = new TypeError('discord-token in an internal error message');
    error.stack = 'openai-key in an internal stack';
    Object.assign(error, { code: 'E_CONNECTION' });

    createLogger('info', output).info({ nested: { error } });

    expect(written).toContain('"name":"TypeError"');
    expect(written).toContain('"class":"TypeError"');
    expect(written).toContain('"code":"E_CONNECTION"');
    expect(written).not.toContain('discord-token');
    expect(written).not.toContain('openai-key');
    expect(written).not.toContain('message');
    expect(written).not.toContain('stack');
  });
});
