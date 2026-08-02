import { z } from 'zod';
import type { RuntimeIdentity } from './runtime-identity.js';

type LogLevel =
  'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

export interface AppConfig {
  readonly runtimeIdentity?: RuntimeIdentity;
  readonly ai: Readonly<{
    provider: 'openai' | 'ollama';
  }>;
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
  readonly ollama: Readonly<{
    baseUrl: string;
    model: string;
    timeoutMs: number;
    maxRetries: number;
  }>;
  readonly webSearch: Readonly<{
    apiKey: string;
    timeoutMs: number;
    cacheTtlMs: number;
    maxResults: number;
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
  readonly faq: Readonly<{
    catalogPath: string;
  }>;
  readonly polls: PollConfig;
  readonly logging: Readonly<{
    level: LogLevel;
  }>;
}

export interface PollConfig {
  readonly enabled: boolean;
  readonly adminUserIds: ReadonlySet<string>;
  readonly voterSecret: string;
  readonly retentionDays: number;
  readonly expiryCheckSeconds: number;
}

export interface DiscordRegistrationConfig {
  readonly token: string;
  readonly clientId: string;
  readonly guildId: string;
  readonly maxInputChars: number;
  readonly faqCatalogPath: string;
  readonly pollsEnabled: boolean;
}

const requiredString = z.string().trim().min(1);

const optionalString = (defaultValue: string) =>
  z.string().trim().min(1).default(defaultValue);

const integer = (defaultValue: number, minimum: number, maximum?: number) =>
  z.preprocess(
    (value) => {
      if (typeof value !== 'string' || value.trim() === '') {
        return value;
      }

      return Number(value);
    },
    (maximum === undefined
      ? z.number().int().min(minimum)
      : z.number().int().min(minimum).max(maximum)
    ).default(defaultValue),
  );

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

const pollAdminUserIds = z.preprocess(
  (value) => {
    if (typeof value !== 'string' || value.trim() === '') {
      return [];
    }

    return value
      .split(',')
      .map((userId) => userId.trim())
      .filter(Boolean);
  },
  z.array(z.string().regex(/^\d{17,20}$/)).default([]),
);

const baseEnvironmentSchema = z.object({
  DISCORD_TOKEN: requiredString,
  DISCORD_CLIENT_ID: requiredString,
  DISCORD_GUILD_ID: requiredString,
  AI_PROVIDER: z.enum(['openai', 'ollama']).default('openai'),
  OPENAI_API_KEY: z.string().trim().default(''),
  OPENAI_MODEL: optionalString('gpt-5.6-luna'),
  OLLAMA_BASE_URL: z
    .url()
    .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol))
    .default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: optionalString('gemma3:4b'),
  OLLAMA_TIMEOUT_MS: integer(120000, 1),
  OLLAMA_MAX_RETRIES: integer(1, 0, 10),
  TAVILY_API_KEY: z.string().trim().default(''),
  WEB_SEARCH_TIMEOUT_MS: integer(10000, 1),
  WEB_SEARCH_CACHE_TTL_MS: integer(3600000, 1),
  WEB_SEARCH_MAX_RESULTS: integer(5, 1, 5),
  MAX_HISTORY_MESSAGES: integer(20, 1),
  MAX_STORED_MESSAGES: integer(10000, 1),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),
  DATABASE_PATH: optionalString('./data/discord-bot.db'),
  MAX_INPUT_CHARS: integer(12000, 1),
  OPENAI_TIMEOUT_MS: integer(45000, 1),
  OPENAI_MAX_RETRIES: integer(3, 0, 10),
  RATE_LIMIT_REQUESTS: integer(5, 1),
  RATE_LIMIT_WINDOW_MS: integer(60000, 1),
  HISTORY_RETENTION_DAYS: integer(30, 1),
  PERSONA_PROMPT_PATH: optionalString('./config/jarvis-persona.md'),
  FAQ_CATALOG_PATH: optionalString('./config/faq.json'),
  ALLOWED_CHANNEL_IDS: channelIds,
  RESTRAINED_CHANNEL_IDS: channelIds,
  POLL_ADMIN_USER_IDS: pollAdminUserIds,
  POLL_VOTER_SECRET: z.string().trim().default(''),
  POLL_RETENTION_DAYS: integer(30, 1),
  POLL_EXPIRY_CHECK_SECONDS: integer(30, 1),
});

type PollEnvironment = Pick<
  z.infer<typeof baseEnvironmentSchema>,
  'POLL_ADMIN_USER_IDS' | 'POLL_VOTER_SECRET'
>;

const validatePollConfiguration = (
  value: PollEnvironment,
  context: z.RefinementCtx,
): void => {
  const hasAdministrators = value.POLL_ADMIN_USER_IDS.length > 0;
  const hasVoterSecret = value.POLL_VOTER_SECRET !== '';

  if (hasAdministrators !== hasVoterSecret) {
    context.addIssue({
      code: 'custom',
      path: [hasAdministrators ? 'POLL_VOTER_SECRET' : 'POLL_ADMIN_USER_IDS'],
      message: 'Poll credentials must be configured together.',
    });
    return;
  }

  if (hasVoterSecret && value.POLL_VOTER_SECRET.length < 32) {
    context.addIssue({
      code: 'custom',
      path: ['POLL_VOTER_SECRET'],
      message: 'POLL_VOTER_SECRET must contain at least 32 characters.',
    });
  }
};

const environmentSchema = baseEnvironmentSchema.superRefine(
  (value, context) => {
    if (value.AI_PROVIDER === 'openai' && value.OPENAI_API_KEY === '') {
      context.addIssue({
        code: 'custom',
        path: ['OPENAI_API_KEY'],
        message: 'OPENAI_API_KEY is required when AI_PROVIDER=openai.',
      });
    }

    validatePollConfiguration(value, context);
  },
);

const discordRegistrationSchema = baseEnvironmentSchema
  .pick({
    DISCORD_TOKEN: true,
    DISCORD_CLIENT_ID: true,
    DISCORD_GUILD_ID: true,
    MAX_INPUT_CHARS: true,
    FAQ_CATALOG_PATH: true,
    POLL_ADMIN_USER_IDS: true,
    POLL_VOTER_SECRET: true,
  })
  .superRefine(validatePollConfiguration);

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
  const parsed = parseEnvironment(environmentSchema, env);
  return Object.freeze({
    runtimeIdentity: Object.freeze({
      version: env.JARVIS_VERSION?.trim() || '0.1.0',
      commit: env.JARVIS_COMMIT_SHA?.trim() || 'development',
      builtAt: env.JARVIS_BUILD_TIMESTAMP?.trim() || 'unknown',
      environment: env.JARVIS_ENVIRONMENT?.trim() || 'development',
    }),
    ai: Object.freeze({ provider: parsed.AI_PROVIDER }),
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
    ollama: Object.freeze({
      baseUrl: parsed.OLLAMA_BASE_URL.replace(/\/+$/, ''),
      model: parsed.OLLAMA_MODEL,
      timeoutMs: parsed.OLLAMA_TIMEOUT_MS,
      maxRetries: parsed.OLLAMA_MAX_RETRIES,
    }),
    webSearch: Object.freeze({
      apiKey: parsed.TAVILY_API_KEY,
      timeoutMs: parsed.WEB_SEARCH_TIMEOUT_MS,
      cacheTtlMs: parsed.WEB_SEARCH_CACHE_TTL_MS,
      maxResults: parsed.WEB_SEARCH_MAX_RESULTS,
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
    faq: Object.freeze({ catalogPath: parsed.FAQ_CATALOG_PATH }),
    polls: Object.freeze({
      enabled: parsed.POLL_ADMIN_USER_IDS.length > 0,
      adminUserIds: readonlySet(parsed.POLL_ADMIN_USER_IDS),
      voterSecret: parsed.POLL_VOTER_SECRET,
      retentionDays: parsed.POLL_RETENTION_DAYS,
      expiryCheckSeconds: parsed.POLL_EXPIRY_CHECK_SECONDS,
    }),
    logging: Object.freeze({ level: parsed.LOG_LEVEL }),
  });
};

export const loadDiscordRegistrationConfig = (
  env: NodeJS.ProcessEnv,
): DiscordRegistrationConfig => {
  const parsed = parseEnvironment(discordRegistrationSchema, env);
  return Object.freeze({
    token: parsed.DISCORD_TOKEN,
    clientId: parsed.DISCORD_CLIENT_ID,
    guildId: parsed.DISCORD_GUILD_ID,
    maxInputChars: parsed.MAX_INPUT_CHARS,
    faqCatalogPath: parsed.FAQ_CATALOG_PATH,
    pollsEnabled: parsed.POLL_ADMIN_USER_IDS.length > 0,
  });
};

function parseEnvironment<T>(schema: z.ZodType<T>, env: NodeJS.ProcessEnv): T {
  const result = schema.safeParse(env);
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
  return result.data;
}
