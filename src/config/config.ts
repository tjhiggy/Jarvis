import { z } from 'zod';

type LogLevel =
  'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

export interface AppConfig {
  readonly discord: Readonly<{
    token: string;
    clientId: string;
    guildId: string;
  }>;
  readonly openai: Readonly<{
    apiKey: string;
    model: string;
    timeoutMs: number;
    maxRetries: number;
  }>;
  readonly storage: Readonly<{
    databasePath: string;
    maxHistoryMessages: number;
    maxStoredMessages: number;
    historyRetentionDays: number;
  }>;
  readonly security: Readonly<{
    allowedChannelIds: ReadonlySet<string>;
    maxInputChars: number;
    rateLimitRequests: number;
    rateLimitWindowMs: number;
  }>;
  readonly persona: Readonly<{
    restrainedChannelIds: ReadonlySet<string>;
    promptPath: string;
  }>;
  readonly logging: Readonly<{
    level: LogLevel;
  }>;
}

const requiredString = z.string().trim().min(1);

const optionalString = (defaultValue: string) =>
  z.string().trim().min(1).default(defaultValue);

const integer = (defaultValue: number, minimum: number) =>
  z.preprocess((value) => {
    if (typeof value !== 'string' || value.trim() === '') {
      return value;
    }

    return Number(value);
  }, z.number().int().min(minimum).default(defaultValue));

const channelIds = z.preprocess(
  (value) => {
    if (typeof value !== 'string' || value.trim() === '') {
      return [];
    }

    return value
      .split(',')
      .map((channelId) => channelId.trim())
      .filter(Boolean);
  },
  z.array(z.string().min(1)).default([]),
);

const environmentSchema = z.object({
  DISCORD_TOKEN: requiredString,
  DISCORD_CLIENT_ID: requiredString,
  DISCORD_GUILD_ID: requiredString,
  OPENAI_API_KEY: requiredString,
  OPENAI_MODEL: optionalString('gpt-5.6-luna'),
  MAX_HISTORY_MESSAGES: integer(20, 1),
  MAX_STORED_MESSAGES: integer(10000, 1),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),
  DATABASE_PATH: optionalString('./data/discord-bot.db'),
  MAX_INPUT_CHARS: integer(12000, 1),
  OPENAI_TIMEOUT_MS: integer(45000, 1),
  OPENAI_MAX_RETRIES: integer(3, 0),
  RATE_LIMIT_REQUESTS: integer(5, 1),
  RATE_LIMIT_WINDOW_MS: integer(60000, 1),
  HISTORY_RETENTION_DAYS: integer(30, 1),
  PERSONA_PROMPT_PATH: optionalString('./config/jarvis-persona.md'),
  ALLOWED_CHANNEL_IDS: channelIds,
  RESTRAINED_CHANNEL_IDS: channelIds,
});

const readonlySet = (values: string[]): ReadonlySet<string> => {
  const valuesSet = new Set(values);
  const result: ReadonlySet<string> = {
    get size() {
      return valuesSet.size;
    },
    has: (value) => valuesSet.has(value),
    entries: () => valuesSet.entries(),
    keys: () => valuesSet.keys(),
    values: () => valuesSet.values(),
    forEach: (callbackfn, thisArg) => {
      valuesSet.forEach((value) => {
        callbackfn.call(thisArg, value, value, result);
      });
    },
    [Symbol.iterator]: () => valuesSet[Symbol.iterator](),
  };

  return Object.freeze(result);
};

export const loadConfig = (env: NodeJS.ProcessEnv): AppConfig => {
  const result = environmentSchema.safeParse(env);

  if (!result.success) {
    const variables = [
      ...new Set(
        result.error.issues.map((issue) => String(issue.path[0] ?? 'unknown')),
      ),
    ];
    throw new Error(
      `Invalid environment configuration: ${variables.join(', ')}`,
    );
  }

  const parsed = result.data;
  return Object.freeze({
    discord: Object.freeze({
      token: parsed.DISCORD_TOKEN,
      clientId: parsed.DISCORD_CLIENT_ID,
      guildId: parsed.DISCORD_GUILD_ID,
    }),
    openai: Object.freeze({
      apiKey: parsed.OPENAI_API_KEY,
      model: parsed.OPENAI_MODEL,
      timeoutMs: parsed.OPENAI_TIMEOUT_MS,
      maxRetries: parsed.OPENAI_MAX_RETRIES,
    }),
    storage: Object.freeze({
      databasePath: parsed.DATABASE_PATH,
      maxHistoryMessages: parsed.MAX_HISTORY_MESSAGES,
      maxStoredMessages: parsed.MAX_STORED_MESSAGES,
      historyRetentionDays: parsed.HISTORY_RETENTION_DAYS,
    }),
    security: Object.freeze({
      allowedChannelIds: readonlySet(parsed.ALLOWED_CHANNEL_IDS),
      maxInputChars: parsed.MAX_INPUT_CHARS,
      rateLimitRequests: parsed.RATE_LIMIT_REQUESTS,
      rateLimitWindowMs: parsed.RATE_LIMIT_WINDOW_MS,
    }),
    persona: Object.freeze({
      restrainedChannelIds: readonlySet(parsed.RESTRAINED_CHANNEL_IDS),
      promptPath: parsed.PERSONA_PROMPT_PATH,
    }),
    logging: Object.freeze({ level: parsed.LOG_LEVEL }),
  });
};
