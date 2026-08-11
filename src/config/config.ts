import { z } from 'zod';
import { parseRoleMenuConfig } from '../engagement/role-menus.js';
import type { RuntimeIdentity } from './runtime-identity.js';
import { loadRuntimeIdentity } from './runtime-identity.js';

type LogLevel =
  'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

export interface AppConfig {
  readonly adminConsole?: Readonly<{
    enabled: boolean;
    port: number;
    host: string;
    token: string;
  }>;
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
  readonly sleeper?: Readonly<{ leagueId: string }>;
  readonly github?: Readonly<{
    owner: string;
    repo: string;
    token: string;
    timeoutMs: number;
  }>;
  readonly polls: PollConfig;
  readonly engagement: EngagementConfig;
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

export interface EngagementConfig {
  readonly enabled: boolean;
  readonly channels: Readonly<{
    introductionId: string;
    suggestionId: string;
    eventId: string;
    recapId: string;
    activityId: string;
    birthdayId: string;
    rssId: string;
  }>;
  readonly rssAllowedHosts: readonly string[];
  readonly adminRoleIds: ReadonlySet<string>;
  readonly recapSchedule: string;
  readonly recapTimezone: string;
  readonly retentionDays: number;
  readonly maxRecordsPerUser: number;
  readonly maxParticipants: number;
  readonly roleMenuChoices?: readonly import('../engagement/role-menus.js').RoleMenuChoice[];
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

const discordSnowflake = /^\d{17,20}$/;

const optionalDiscordSnowflake = z
  .string()
  .trim()
  .regex(/^$|^\d{17,20}$/)
  .default('');

const engagementAdminRoleIds = z.preprocess(
  (value) => {
    if (typeof value !== 'string' || value.trim() === '') {
      return [];
    }

    return value
      .split(',')
      .map((roleId) => roleId.trim())
      .filter(Boolean);
  },
  z.array(z.string().regex(discordSnowflake)).default([]),
);

const isValidTimeZone = (value: string): boolean => {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
};

const engagementTimezone = z.preprocess(
  (value) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  z.string().trim().refine(isValidTimeZone).default('UTC'),
);

const baseEnvironmentSchema = z.object({
  ADMIN_CONSOLE_ENABLED: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.enum(['true', 'false']).default('false'),
  ),
  ADMIN_CONSOLE_PORT: integer(8787, 0, 65535),
  ADMIN_CONSOLE_HOST: z
    .string()
    .trim()
    .regex(/^(?:127\.0\.0\.1|localhost)$/)
    .default('127.0.0.1'),
  ADMIN_CONSOLE_TOKEN: z.string().trim().default(''),
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
  SLEEPER_LEAGUE_ID: z
    .string()
    .trim()
    .regex(/^$|^\d{8,20}$/)
    .default(''),
  GITHUB_OWNER: z
    .string()
    .trim()
    .regex(/^$|^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/)
    .default(''),
  GITHUB_REPO: z
    .string()
    .trim()
    .regex(/^$|^[A-Za-z0-9_.-]{1,100}$/)
    .default(''),
  GITHUB_TOKEN: z.string().trim().default(''),
  GITHUB_TIMEOUT_MS: integer(8000, 1000, 30000),
  ALLOWED_CHANNEL_IDS: channelIds,
  RESTRAINED_CHANNEL_IDS: channelIds,
  POLL_ADMIN_USER_IDS: pollAdminUserIds,
  POLL_VOTER_SECRET: z.string().trim().default(''),
  POLL_RETENTION_DAYS: integer(30, 1),
  POLL_EXPIRY_CHECK_SECONDS: integer(30, 1),
  ENGAGEMENT_ENABLED: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.enum(['true', 'false']).default('false'),
  ),
  ENGAGEMENT_INTRODUCTION_CHANNEL_ID: optionalDiscordSnowflake,
  ENGAGEMENT_SUGGESTION_CHANNEL_ID: optionalDiscordSnowflake,
  ENGAGEMENT_EVENT_CHANNEL_ID: optionalDiscordSnowflake,
  ENGAGEMENT_RECAP_CHANNEL_ID: optionalDiscordSnowflake,
  ENGAGEMENT_ACTIVITY_CHANNEL_ID: optionalDiscordSnowflake,
  ENGAGEMENT_BIRTHDAY_CHANNEL_ID: optionalDiscordSnowflake,
  ENGAGEMENT_RSS_CHANNEL_ID: optionalDiscordSnowflake,
  ENGAGEMENT_RSS_ALLOWED_HOSTS: z.string().trim().default(''),
  ENGAGEMENT_ROLE_MENU_OPTIONS: z.string().trim().default(''),
  ENGAGEMENT_ADMIN_ROLE_IDS: engagementAdminRoleIds,
  ENGAGEMENT_RECAP_SCHEDULE: z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : value,
    z
      .string()
      .trim()
      .regex(
        /^(?:MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY) (?:[01]\d|2[0-3]):[0-5]\d$/,
      )
      .default(''),
  ),
  ENGAGEMENT_RECAP_TIMEZONE: engagementTimezone,
  ENGAGEMENT_RETENTION_DAYS: integer(30, 1, 90),
  ENGAGEMENT_MAX_RECORDS_PER_USER: integer(5, 1, 25),
  ENGAGEMENT_MAX_PARTICIPANTS: integer(100, 2, 1000),
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

type EngagementEnvironment = Pick<
  z.infer<typeof baseEnvironmentSchema>,
  | 'ENGAGEMENT_ENABLED'
  | 'ENGAGEMENT_INTRODUCTION_CHANNEL_ID'
  | 'ENGAGEMENT_SUGGESTION_CHANNEL_ID'
  | 'ENGAGEMENT_EVENT_CHANNEL_ID'
  | 'ENGAGEMENT_RECAP_CHANNEL_ID'
  | 'ENGAGEMENT_ACTIVITY_CHANNEL_ID'
  | 'ENGAGEMENT_BIRTHDAY_CHANNEL_ID'
  | 'ENGAGEMENT_ADMIN_ROLE_IDS'
  | 'ENGAGEMENT_RECAP_SCHEDULE'
>;

const validateEngagementConfiguration = (
  value: EngagementEnvironment,
  context: z.RefinementCtx,
): void => {
  const channelIds = [
    value.ENGAGEMENT_INTRODUCTION_CHANNEL_ID,
    value.ENGAGEMENT_SUGGESTION_CHANNEL_ID,
    value.ENGAGEMENT_EVENT_CHANNEL_ID,
    value.ENGAGEMENT_RECAP_CHANNEL_ID,
    value.ENGAGEMENT_ACTIVITY_CHANNEL_ID,
    value.ENGAGEMENT_BIRTHDAY_CHANNEL_ID,
  ];
  const hasConfiguredChannel = channelIds.some((channelId) => channelId !== '');

  if (value.ENGAGEMENT_ENABLED === 'true' && !hasConfiguredChannel) {
    context.addIssue({
      code: 'custom',
      path: ['ENGAGEMENT_ENABLED'],
      message: 'Enabled engagement requires at least one configured channel.',
    });
  }

  if (
    value.ENGAGEMENT_ENABLED === 'true' &&
    value.ENGAGEMENT_ADMIN_ROLE_IDS.length === 0
  ) {
    context.addIssue({
      code: 'custom',
      path: ['ENGAGEMENT_ADMIN_ROLE_IDS'],
      message: 'Enabled engagement requires at least one administrator role.',
    });
  }

  if (
    value.ENGAGEMENT_RECAP_SCHEDULE !== '' &&
    (value.ENGAGEMENT_ENABLED !== 'true' ||
      value.ENGAGEMENT_RECAP_CHANNEL_ID === '')
  ) {
    context.addIssue({
      code: 'custom',
      path: ['ENGAGEMENT_RECAP_SCHEDULE'],
      message:
        'A recap schedule requires enabled engagement and a recap channel.',
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
    validateEngagementConfiguration(value, context);
    if (
      value.ADMIN_CONSOLE_ENABLED === 'true' &&
      value.ADMIN_CONSOLE_TOKEN.trim() === ''
    ) {
      context.addIssue({
        code: 'custom',
        path: ['ADMIN_CONSOLE_TOKEN'],
        message:
          'ADMIN_CONSOLE_TOKEN is required when ADMIN_CONSOLE_ENABLED=true.',
      });
    }
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
    adminConsole: Object.freeze({
      enabled: parsed.ADMIN_CONSOLE_ENABLED === 'true',
      port: parsed.ADMIN_CONSOLE_PORT,
      host: parsed.ADMIN_CONSOLE_HOST,
      token: parsed.ADMIN_CONSOLE_TOKEN,
    }),
    // Build identity is configuration metadata only. It is never inferred
    // from the host, package manager, or Discord content.
    runtimeIdentity: loadRuntimeIdentity(env),
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
    sleeper: Object.freeze({ leagueId: parsed.SLEEPER_LEAGUE_ID }),
    ...(parsed.GITHUB_OWNER && parsed.GITHUB_REPO
      ? {
          github: Object.freeze({
            owner: parsed.GITHUB_OWNER,
            repo: parsed.GITHUB_REPO,
            token: parsed.GITHUB_TOKEN,
            timeoutMs: parsed.GITHUB_TIMEOUT_MS,
          }),
        }
      : {}),
    polls: Object.freeze({
      enabled: parsed.POLL_ADMIN_USER_IDS.length > 0,
      adminUserIds: readonlySet(parsed.POLL_ADMIN_USER_IDS),
      voterSecret: parsed.POLL_VOTER_SECRET,
      retentionDays: parsed.POLL_RETENTION_DAYS,
      expiryCheckSeconds: parsed.POLL_EXPIRY_CHECK_SECONDS,
    }),
    engagement: Object.freeze({
      enabled: parsed.ENGAGEMENT_ENABLED === 'true',
      channels: Object.freeze({
        introductionId: parsed.ENGAGEMENT_INTRODUCTION_CHANNEL_ID,
        suggestionId: parsed.ENGAGEMENT_SUGGESTION_CHANNEL_ID,
        eventId: parsed.ENGAGEMENT_EVENT_CHANNEL_ID,
        recapId: parsed.ENGAGEMENT_RECAP_CHANNEL_ID,
        activityId: parsed.ENGAGEMENT_ACTIVITY_CHANNEL_ID,
        birthdayId: parsed.ENGAGEMENT_BIRTHDAY_CHANNEL_ID,
        rssId: parsed.ENGAGEMENT_RSS_CHANNEL_ID,
      }),
      rssAllowedHosts: Object.freeze(
        parsed.ENGAGEMENT_RSS_ALLOWED_HOSTS.split(',')
          .map((host) => host.trim().toLowerCase())
          .filter(Boolean),
      ),
      adminRoleIds: readonlySet(parsed.ENGAGEMENT_ADMIN_ROLE_IDS),
      recapSchedule: parsed.ENGAGEMENT_RECAP_SCHEDULE,
      recapTimezone: parsed.ENGAGEMENT_RECAP_TIMEZONE,
      retentionDays: parsed.ENGAGEMENT_RETENTION_DAYS,
      maxRecordsPerUser: parsed.ENGAGEMENT_MAX_RECORDS_PER_USER,
      maxParticipants: parsed.ENGAGEMENT_MAX_PARTICIPANTS,
      roleMenuChoices: Object.freeze(
        parseRoleMenuConfig(parsed.ENGAGEMENT_ROLE_MENU_OPTIONS),
      ),
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
