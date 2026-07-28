import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/config.js';

const validEnv = {
  DISCORD_TOKEN: 'discord-token',
  DISCORD_CLIENT_ID: '123',
  DISCORD_GUILD_ID: '456',
  OPENAI_API_KEY: 'openai-key',
};

describe('loadConfig', () => {
  it('rejects missing required values without exposing supplied secrets', () => {
    expect(() => loadConfig({ OPENAI_API_KEY: 'do-not-print' })).toThrow(
      /DISCORD_TOKEN/,
    );
    expect(() => loadConfig({ OPENAI_API_KEY: 'do-not-print' })).not.toThrow(
      /do-not-print/,
    );
  });

  it('applies safe defaults and parses channel lists', () => {
    const config = loadConfig({
      ...validEnv,
      ALLOWED_CHANNEL_IDS: '1, 2',
      RESTRAINED_CHANNEL_IDS: '3',
    });
    expect(config.openai.model).toBe('gpt-5.6-luna');
    expect(config.security.allowedChannelIds).toEqual(new Set(['1', '2']));
    expect(config.persona.restrainedChannelIds).toEqual(new Set(['3']));
    expect(config.storage.maxHistoryMessages).toBe(20);
  });

  it('rejects invalid limits', () => {
    expect(() =>
      loadConfig({ ...validEnv, MAX_HISTORY_MESSAGES: '0' }),
    ).toThrow(/MAX_HISTORY_MESSAGES/);
  });

  it('returns immutable configuration', () => {
    const config = loadConfig({ ...validEnv, ALLOWED_CHANNEL_IDS: '1' });

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.security)).toBe(true);
    expect(() =>
      (config.security.allowedChannelIds as Set<string>).add('2'),
    ).toThrow(/read-only/);
  });
});
