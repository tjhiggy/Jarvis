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
});
