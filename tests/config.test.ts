import { describe, expect, it } from 'vitest';
import {
  loadConfig,
  loadDiscordRegistrationConfig,
} from '../src/config/config.js';

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

  it('loads the FAQ catalog path with a default and override', () => {
    expect(loadConfig(validEnv).faq.catalogPath).toBe('./config/faq.json');
    expect(
      loadConfig({ ...validEnv, FAQ_CATALOG_PATH: './config/custom-faq.json' })
        .faq.catalogPath,
    ).toBe('./config/custom-faq.json');
  });

  it('rejects invalid limits', () => {
    expect(() =>
      loadConfig({ ...validEnv, MAX_HISTORY_MESSAGES: '0' }),
    ).toThrow(/MAX_HISTORY_MESSAGES/);
    expect(() => loadConfig({ ...validEnv, MAX_STORED_MESSAGES: '0' })).toThrow(
      /MAX_STORED_MESSAGES/,
    );
    expect(() => loadConfig({ ...validEnv, OPENAI_MAX_RETRIES: '11' })).toThrow(
      /OPENAI_MAX_RETRIES/,
    );
  });

  it('allows Ollama without an OpenAI API key and normalizes its URL', () => {
    const config = loadConfig({
      DISCORD_TOKEN: 'discord-token',
      DISCORD_CLIENT_ID: '123',
      DISCORD_GUILD_ID: '456',
      AI_PROVIDER: 'ollama',
      OLLAMA_BASE_URL: 'http://host.docker.internal:11434/',
      OLLAMA_MODEL: 'qwen3:8b',
    });

    expect(config.ai.provider).toBe('ollama');
    expect(config.ollama).toEqual({
      baseUrl: 'http://host.docker.internal:11434',
      model: 'qwen3:8b',
      timeoutMs: 120_000,
      maxRetries: 1,
    });
    expect(config.openai.apiKey).toBe('');
    expect(config.webSearch).toEqual({
      apiKey: '',
      timeoutMs: 10_000,
      cacheTtlMs: 3_600_000,
      maxResults: 5,
    });
  });

  it('loads bounded Tavily web-search settings without exposing the key', () => {
    const config = loadConfig({
      ...validEnv,
      TAVILY_API_KEY: 'tvly-secret',
      WEB_SEARCH_TIMEOUT_MS: '7000',
      WEB_SEARCH_CACHE_TTL_MS: '1800000',
      WEB_SEARCH_MAX_RESULTS: '3',
    });

    expect(config.webSearch).toEqual({
      apiKey: 'tvly-secret',
      timeoutMs: 7_000,
      cacheTtlMs: 1_800_000,
      maxResults: 3,
    });
    expect(() =>
      loadConfig({ ...validEnv, WEB_SEARCH_MAX_RESULTS: '6' }),
    ).toThrow(/WEB_SEARCH_MAX_RESULTS/);
  });

  it('still requires an API key when OpenAI is selected', () => {
    expect(() =>
      loadConfig({
        DISCORD_TOKEN: 'discord-token',
        DISCORD_CLIENT_ID: '123',
        DISCORD_GUILD_ID: '456',
        AI_PROVIDER: 'openai',
      }),
    ).toThrow(/OPENAI_API_KEY/);
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

describe('loadDiscordRegistrationConfig', () => {
  it('loads only the Discord registration values without requiring OpenAI', () => {
    expect(
      loadDiscordRegistrationConfig({
        DISCORD_TOKEN: 'discord-token',
        DISCORD_CLIENT_ID: 'client-id',
        DISCORD_GUILD_ID: 'guild-id',
        MAX_INPUT_CHARS: '123',
      }),
    ).toEqual({
      token: 'discord-token',
      clientId: 'client-id',
      guildId: 'guild-id',
      maxInputChars: 123,
      faqCatalogPath: './config/faq.json',
    });
  });

  it('loads an FAQ catalog path override without requiring OpenAI', () => {
    expect(
      loadDiscordRegistrationConfig({
        DISCORD_TOKEN: 'discord-token',
        DISCORD_CLIENT_ID: 'client-id',
        DISCORD_GUILD_ID: 'guild-id',
        FAQ_CATALOG_PATH: './config/registration-faq.json',
      }).faqCatalogPath,
    ).toBe('./config/registration-faq.json');
  });
});
