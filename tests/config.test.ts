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
    expect([...config.security.allowedChannelIds]).toEqual(['1', '2']);
    expect([...config.persona.restrainedChannelIds]).toEqual(['3']);
    expect(config.storage.maxHistoryMessages).toBe(20);
    expect(config.storage.maxStoredMessages).toBe(10_000);
  });

  it('rejects invalid limits', () => {
    expect(() =>
      loadConfig({ ...validEnv, MAX_HISTORY_MESSAGES: '0' }),
    ).toThrow(/MAX_HISTORY_MESSAGES/);
    expect(() => loadConfig({ ...validEnv, MAX_STORED_MESSAGES: '0' })).toThrow(
      /MAX_STORED_MESSAGES/,
    );
  });

  it('keeps channel policy immutable through public and Set prototype paths', () => {
    const config = loadConfig({ ...validEnv, ALLOWED_CHANNEL_IDS: '1' });
    const channelIds = config.security.allowedChannelIds;

    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.security)).toBe(true);
    expect(channelIds.has('1')).toBe(true);
    expect(channelIds.has('2')).toBe(false);
    expect(() => (channelIds as Set<string>).add('2')).toThrow(TypeError);
    expect(() => (channelIds as Set<string>).delete('1')).toThrow(TypeError);
    expect(() => (channelIds as Set<string>).clear()).toThrow(TypeError);
    expect(() => Set.prototype.add.call(channelIds, '2')).toThrow(TypeError);
    expect(() => Set.prototype.delete.call(channelIds, '1')).toThrow(TypeError);
    expect(() => Set.prototype.clear.call(channelIds)).toThrow(TypeError);
    expect([...channelIds]).toEqual(['1']);
    expect(channelIds.has('1')).toBe(true);
    expect(channelIds.has('2')).toBe(false);
  });
});
