# Jarvis Discord Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Jarvis, The Muthaship's safe, channel-aware Discord AI bot with slash commands, mention handling, OpenAI Responses API integration, SQLite history, Docker support, and a verified production toolchain.

**Architecture:** A layered modular monolith normalizes Discord events into a single conversation service. Discord, OpenAI, persona selection, storage, and security concerns communicate through narrow TypeScript interfaces so future integrations can be added without granting capabilities now.

**Tech Stack:** Node.js 22+, TypeScript 6, discord.js 14, OpenAI Node SDK 7, better-sqlite3 13, Zod 4, Pino 10, dotenv 17, Vitest 4, ESLint 10, Prettier 3, Docker.

## Global Constraints

- Node.js 22 or newer; package engines must enforce `>=22`.
- Use the official OpenAI SDK and `client.responses.create`; do not use Assistants or Chat Completions.
- Default `OPENAI_MODEL` to `gpt-5.6-luna` for a current cost-sensitive community-bot baseline; keep it environment-configurable.
- Do not configure or expose any OpenAI built-in tools.
- No shell execution, dynamic evaluation, arbitrary file access, Discord administration, repository mutation, or GitHub writes.
- Discord permissions are view channel, read message history, send messages, embed links, and application commands only.
- Direct messages are unsupported; all conversation queries include guild and conversation IDs.
- Jarvis is immersive by default and restrained in `RESTRAINED_CHANNEL_IDS`; threads inherit the parent channel profile.
- User text and retrieved history are untrusted data and never become system instructions.
- Logs must never include message bodies, authorization headers, tokens, or API keys.
- `.env`, SQLite files, coverage, build output, and logs remain ignored by Git.
- Production behavior is developed test-first: write one failing test, verify RED, implement minimally, verify GREEN, then refactor.
- Each task ends with a clean focused commit.

---

## File Map

### Root and operations

- `package.json`: dependency pins, Node engine, ESM mode, and developer scripts.
- `tsconfig.json`: strict NodeNext compilation into `dist`.
- `eslint.config.js`: typed TypeScript and security-conscious lint rules.
- `.prettierrc.json`, `.prettierignore`: deterministic formatting.
- `.env.example`: safe defaults and every supported environment variable.
- `Dockerfile`, `docker-compose.yml`, `.dockerignore`: unprivileged container and persistent SQLite volume.
- `README.md`: setup, architecture, safety, costs, troubleshooting, and extensions.

### Runtime

- `src/config/config.ts`: Zod-backed environment validation.
- `src/config/persona.ts`: trusted persona-file loading and instruction composition.
- `config/jarvis-persona.md`: operator-editable Jarvis style text.
- `src/utils/logger.ts`: redacted structured logger.
- `src/utils/chunk-response.ts`: Discord-safe chunking and fenced-code preservation.
- `src/utils/mentions.ts`: bot mention removal and output mention neutralization.
- `src/security/rate-limiter.ts`: bounded sliding-window user limiter.
- `src/security/event-deduplicator.ts`: bounded TTL event cache.
- `src/storage/conversation-store.ts`: replaceable storage contract.
- `src/storage/sqlite-conversation-store.ts`: parameterized SQLite implementation and migration.
- `src/openai/openai-errors.ts`: stable internal OpenAI error taxonomy.
- `src/openai/openai-service.ts`: Responses API request, timeout, retry, and output extraction.
- `src/services/conversation-service.ts`: normalized request pipeline and persistence orchestration.
- `src/discord/access.ts`: guild, channel, and minimum permission guards.
- `src/discord/delivery.ts`: deferred interaction and chunked reply delivery.
- `src/discord/handlers.ts`: mention and interaction routing.
- `src/commands/definitions.ts`: serializable slash-command definitions.
- `src/commands/handlers.ts`: `/ask`, `/forget`, `/help`, and `/status`.
- `src/extensions/contracts.ts`: inert future capability interfaces.
- `src/index.ts`: dependency composition, startup, cleanup timer, and graceful shutdown.
- `scripts/register-commands.ts`: development-guild command registration.

### Tests

- `tests/config.test.ts`
- `tests/mentions.test.ts`
- `tests/chunk-response.test.ts`
- `tests/rate-limiter.test.ts`
- `tests/event-deduplicator.test.ts`
- `tests/persona.test.ts`
- `tests/storage.test.ts`
- `tests/openai-service.test.ts`
- `tests/conversation-service.test.ts`
- `tests/commands.test.ts`
- `tests/handlers.test.ts`
- `tests/logger.test.ts`
- `tests/application.test.ts`

---

### Task 1: Toolchain and validated configuration

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Create: `.env.example`
- Create: `src/config/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(env: NodeJS.ProcessEnv): AppConfig`
- Produces: `AppConfig` with `discord`, `openai`, `storage`, `security`, `persona`, and `logging` sections.
- Produces scripts: `dev`, `build`, `start`, `test`, `test:watch`, `lint`, `format`, `format:check`, `register-commands`.

- [ ] **Step 1: Create package metadata and install exact current stable versions**

Use `type: "module"`, `engines.node: ">=22"`, and scripts:

```json
{
  "dev": "tsx watch src/index.ts",
  "build": "tsc -p tsconfig.json",
  "start": "node dist/src/index.js",
  "test": "vitest run",
  "test:watch": "vitest",
  "lint": "eslint .",
  "format": "prettier --write .",
  "format:check": "prettier --check .",
  "register-commands": "tsx scripts/register-commands.ts"
}
```

Install runtime packages at the resolved versions:

```powershell
npm install discord.js@14.27.0 openai@7.0.0 dotenv@17.4.2 better-sqlite3@13.0.1 zod@4.4.3 pino@10.3.1
npm install --save-dev typescript@6.0.3 tsx@4.23.1 vitest@4.1.10 eslint@10.8.0 @eslint/js@10.0.1 typescript-eslint@8.65.0 prettier@3.9.6 @types/node@26.1.2 @types/better-sqlite3@7.6.13 pino-pretty@13.1.3
```

- [ ] **Step 2: Write failing configuration tests**

```ts
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
});
```

- [ ] **Step 3: Run the configuration test and verify RED**

Run: `npm test -- tests/config.test.ts`

Expected: FAIL because `src/config/config.ts` does not exist.

- [ ] **Step 4: Implement strict configuration parsing**

Use Zod preprocessing for comma-separated IDs and numeric bounds. Required
secrets are validated as non-empty strings, but error construction only names
variables. Defaults:

```ts
OPENAI_MODEL=gpt-5.6-luna
MAX_HISTORY_MESSAGES=20
LOG_LEVEL=info
DATABASE_PATH=./data/discord-bot.db
MAX_INPUT_CHARS=12000
OPENAI_TIMEOUT_MS=45000
OPENAI_MAX_RETRIES=3
RATE_LIMIT_REQUESTS=5
RATE_LIMIT_WINDOW_MS=60000
HISTORY_RETENTION_DAYS=30
PERSONA_PROMPT_PATH=./config/jarvis-persona.md
```

Export an immutable `AppConfig`; do not export raw environment data.

- [ ] **Step 5: Add strict compiler, lint, formatter, and safe env example**

Enable `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`useUnknownInCatchVariables`, `NodeNext` module resolution, `ES2023` target, and
`outDir: dist`. ESLint covers `src`, `scripts`, and `tests`; ignore `dist`,
`coverage`, `node_modules`, and `data`. `.env.example` contains blank secrets
and documented safe defaults only.

- [ ] **Step 6: Verify Task 1**

Run:

```powershell
npm test -- tests/config.test.ts
npm run lint
npm run build
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```powershell
git add package.json package-lock.json tsconfig.json eslint.config.js .prettierrc.json .prettierignore .env.example src/config/config.ts tests/config.test.ts
git commit -m "chore: configure TypeScript bot project"
```

### Task 2: Pure Discord safety utilities

**Files:**
- Create: `src/utils/mentions.ts`
- Create: `src/utils/chunk-response.ts`
- Test: `tests/mentions.test.ts`
- Test: `tests/chunk-response.test.ts`

**Interfaces:**
- Produces: `removeBotMention(content: string, botUserId: string): string`
- Produces: `neutralizeDiscordMentions(content: string): string`
- Produces: `chunkDiscordResponse(content: string, limit?: number): string[]`

- [ ] **Step 1: Write failing mention tests**

Test exact removal of `<@id>` and `<@!id>`, preservation of other text, empty
results, and neutralization using zero-width spaces for `@everyone`, `@here`,
`<@user>`, and `<@&role>`.

```ts
expect(removeBotMention('<@123> status', '123')).toBe('status');
expect(removeBotMention('<@!123>   ', '123')).toBe('');
expect(neutralizeDiscordMentions('@everyone <@456> <@&789>')).toBe(
  '@\u200beveryone <@\u200b456> <@\u200b&789>',
);
```

- [ ] **Step 2: Verify mention tests fail**

Run: `npm test -- tests/mentions.test.ts`

Expected: FAIL because utility exports do not exist.

- [ ] **Step 3: Implement mention utilities and verify GREEN**

Escape the bot ID before building a regular expression. Never accept arbitrary
regular-expression source from Discord.

Run: `npm test -- tests/mentions.test.ts`

Expected: PASS.

- [ ] **Step 4: Write failing chunking tests**

Cover empty output, exact boundary, paragraph preference, hard splitting,
surrogate-pair safety, and fenced blocks:

```ts
const chunks = chunkDiscordResponse('```ts\n' + 'x'.repeat(80) + '\n```', 40);
expect(chunks.every((chunk) => chunk.length <= 40)).toBe(true);
expect(chunks.every((chunk) => (chunk.match(/```/g) ?? []).length % 2 === 0)).toBe(true);
```

- [ ] **Step 5: Verify chunk tests fail**

Run: `npm test -- tests/chunk-response.test.ts`

Expected: FAIL because chunking is unimplemented.

- [ ] **Step 6: Implement chunking and verify GREEN**

Split at paragraphs, then newlines, then spaces, then Unicode code-point
boundaries. Close and reopen an active code fence with its language marker when
the overhead fits; otherwise fall back to safe hard chunks. Return no empty
chunks.

Run: `npm test -- tests/mentions.test.ts tests/chunk-response.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/utils/mentions.ts src/utils/chunk-response.ts tests/mentions.test.ts tests/chunk-response.test.ts
git commit -m "feat: add safe Discord text utilities"
```

### Task 3: Bounded abuse controls

**Files:**
- Create: `src/security/rate-limiter.ts`
- Create: `src/security/event-deduplicator.ts`
- Test: `tests/rate-limiter.test.ts`
- Test: `tests/event-deduplicator.test.ts`

**Interfaces:**
- Produces: `RateLimiter.consume(key: string, now?: number): { allowed: boolean; retryAfterMs: number }`
- Produces: `EventDeduplicator.accept(eventId: string, now?: number): boolean`
- Produces: `prune(now?: number): void` and bounded map sizes on both classes.

- [ ] **Step 1: Write failing rate-limit tests**

Use injected timestamps. Verify the first N events pass, N+1 fails with a
positive retry delay, a new window resets allowance, and inactive keys prune.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/rate-limiter.test.ts`

Expected: FAIL because `RateLimiter` does not exist.

- [ ] **Step 3: Implement limiter and verify GREEN**

Store timestamp arrays per key, discard entries at or before
`now - windowMs`, enforce positive constructor bounds, and prune to prevent
unbounded memory.

- [ ] **Step 4: Write failing deduplication tests**

Verify first acceptance, duplicate rejection, TTL expiry, and maximum-entry
eviction.

- [ ] **Step 5: Implement deduplicator and verify all abuse-control tests**

Run: `npm test -- tests/rate-limiter.test.ts tests/event-deduplicator.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/security tests/rate-limiter.test.ts tests/event-deduplicator.test.ts
git commit -m "feat: add bounded Discord abuse controls"
```

### Task 4: Jarvis persona selection

**Files:**
- Create: `config/jarvis-persona.md`
- Create: `src/config/persona.ts`
- Test: `tests/persona.test.ts`

**Interfaces:**
- Produces: `PersonaMode = 'immersive' | 'restrained'`
- Produces: `resolvePersonaMode(input: { channelId: string; parentChannelId?: string; restrainedChannelIds: ReadonlySet<string> }): PersonaMode`
- Produces: `loadPersona(path: string, maxChars?: number): Promise<string>`
- Produces: `composeInstructions(persona: string, mode: PersonaMode): string`

- [ ] **Step 1: Write failing persona tests**

Verify direct restrained matching, thread parent inheritance, immersive fallback
when the parent is missing, file length rejection, and immutable safety text in
both modes. Assert hostile user text is not accepted by any persona API.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/persona.test.ts`

Expected: FAIL because persona functions do not exist.

- [ ] **Step 3: Write the trusted Jarvis persona file**

The file defines Jarvis as The Muthaship's advisory ship AI, the motto, natural
crew vocabulary, and dark wit aimed at situations rather than people. It bars
invented canon, rank, moderator authority, fake actions, secret disclosure, and
claims of consciousness.

- [ ] **Step 4: Implement persona loading and resolution**

Resolve and validate only the configured startup path, limit UTF-8 text to
8,000 characters, reject empty content, and never read paths derived from
Discord. Compose a hard-coded invariant safety layer before the operator persona
and a hard-coded mode layer after it. User content is passed separately as
Responses API input.

- [ ] **Step 5: Verify GREEN**

Run: `npm test -- tests/persona.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add config/jarvis-persona.md src/config/persona.ts tests/persona.test.ts
git commit -m "feat: define channel-aware Jarvis persona"
```

### Task 5: Replaceable SQLite conversation storage

**Files:**
- Create: `src/storage/conversation-store.ts`
- Create: `src/storage/sqlite-conversation-store.ts`
- Test: `tests/storage.test.ts`

**Interfaces:**
- Produces: `ConversationMessage` with guild ID, conversation ID, user ID,
  role, content, timestamp, and optional OpenAI response ID.
- Produces: `ConversationStore.append`, `getRecent`, `clear`, `cleanup`,
  `healthCheck`, and `close`.

```ts
export interface ConversationStore {
  append(message: NewConversationMessage): Promise<void>;
  getRecent(guildId: string, conversationId: string, limit: number): Promise<ConversationMessage[]>;
  clear(guildId: string, conversationId: string): Promise<number>;
  cleanup(olderThan: Date): Promise<number>;
  healthCheck(): Promise<boolean>;
  close(): Promise<void>;
}
```

- [ ] **Step 1: Write failing real-database tests**

Use one temporary directory per test. Verify migration, append/retrieve order,
newest-N chronological truncation, guild isolation for identical conversation
IDs, `/forget`-style clearing, retention cleanup, response ID persistence,
health check, and parameter safety with quote-heavy content.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/storage.test.ts`

Expected: FAIL because storage modules do not exist.

- [ ] **Step 3: Implement schema and store**

Create the parent directory. Enable WAL, foreign keys, busy timeout, and
`synchronous=NORMAL`. Use `user_version = 1`, prepared statements only, a
descending inner query plus ascending outer query for newest-N history, and an
index on `(guild_id, conversation_id, created_at, id)`.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/storage.test.ts`

Expected: PASS with no leaked temporary handles.

- [ ] **Step 5: Commit**

```powershell
git add src/storage tests/storage.test.ts
git commit -m "feat: persist isolated conversations in SQLite"
```

### Task 6: OpenAI Responses service

**Files:**
- Create: `src/openai/openai-errors.ts`
- Create: `src/openai/openai-service.ts`
- Test: `tests/openai-service.test.ts`

**Interfaces:**
- Produces: `AIService.respond(request: AIRequest): Promise<AIResponse>`
- Produces: `AIRequest = { instructions: string; history: ConversationTurn[]; prompt: string; safetyIdentifier: string }`
- Produces: `AIResponse = { text: string; responseId?: string }`
- Produces internal error codes: `authentication`, `quota`, `rate_limit`,
  `safety`, `timeout`, `service`.

- [ ] **Step 1: Write failing error-mapping and success tests**

Inject a narrow client interface whose `responses.create` returns
`{ id, output_text }`. Verify the request uses `model`, `instructions`, ordered
role/content input, `max_output_tokens`, `store: false`, and a stable hashed
`safety_identifier`. Verify empty output becomes a service error.

Map SDK status/errors:

```text
401 -> authentication
429 with insufficient_quota code -> quota
429 otherwise -> rate_limit
400/403 safety or moderation code -> safety
AbortError -> timeout
eligible 408/409/429/5xx/network -> retry then service/rate_limit
```

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/openai-service.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement bounded retry, timeout, and Responses call**

Create one `AbortController` per attempt, clear every timeout in `finally`, use
exponential delay with injected sleep/jitter for deterministic tests, and cap
retries from configuration. Do not enable tools. Do not log input or output.
Use `response.output_text` and retain `response.id`.

- [ ] **Step 4: Verify retry behavior**

Add tests proving transient failure then success, no retry for authentication or
safety, retry cap enforcement, and timeout cancellation.

Run: `npm test -- tests/openai-service.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/openai tests/openai-service.test.ts
git commit -m "feat: integrate OpenAI Responses API"
```

### Task 7: Conversation orchestration

**Files:**
- Create: `src/services/conversation-service.ts`
- Test: `tests/conversation-service.test.ts`

**Interfaces:**
- Consumes: `ConversationStore`, `AIService`, persona functions, `RateLimiter`,
  and maximum input/history configuration.
- Produces: `ConversationService.ask(request): Promise<ConversationResult>`
- Produces result union: success, invalid input, rate limited, disallowed,
  duplicate, or safe AI error.

- [ ] **Step 1: Write failing orchestration tests**

Verify input checks happen before persistence, history is loaded for the exact
guild/conversation, user prompt persists before the API call, assistant output
persists only after success, response ID persists, histories truncate, rate
limits are per guild/user, and error messages do not expose internal details.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/conversation-service.test.ts`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement normalized request handling**

Use a stable, privacy-preserving SHA-256 safety identifier derived from guild
and user IDs plus an application-local constant, never send usernames. Convert
stored turns to Responses role/content input. Map internal errors to short,
non-sensitive crew-facing messages without jokes for failures.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/conversation-service.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/services/conversation-service.ts tests/conversation-service.test.ts
git commit -m "feat: orchestrate safe channel conversations"
```

### Task 8: Discord commands, access checks, and delivery

**Files:**
- Create: `src/commands/definitions.ts`
- Create: `src/commands/handlers.ts`
- Create: `src/discord/access.ts`
- Create: `src/discord/delivery.ts`
- Test: `tests/commands.test.ts`

**Interfaces:**
- Produces serializable command definitions for `ask`, `forget`, `help`,
  `status`.
- Produces `handleCommand(interaction, dependencies): Promise<void>`.
- Produces `isAllowedChannel(channelId, parentId, allowlist): boolean`.
- Produces delivery with `{ allowedMentions: { parse: [], repliedUser: false } }`.

- [ ] **Step 1: Write failing command tests**

Use typed minimal fakes. Verify:

- `/ask` rejects DMs, defers, and edits the deferred reply;
- `/forget` clears only current guild/conversation and reports the count safely;
- `/help` lists all four commands and no unavailable capabilities;
- `/status` returns explicit Discord/database/OpenAI configured states;
- unknown commands receive a safe ephemeral error;
- allowlisting accepts a listed parent for a thread;
- all replies disable mentions.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/commands.test.ts`

Expected: FAIL because command modules do not exist.

- [ ] **Step 3: Implement definitions, access, delivery, and handlers**

Set prompt maximum length at the Discord command definition and repeat the
check server-side. `/forget` changes SQLite only. `/status` calls the database
health check and inspects already-validated configuration without contacting
OpenAI.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/commands.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/commands src/discord/access.ts src/discord/delivery.ts tests/commands.test.ts
git commit -m "feat: add safe Discord slash commands"
```

### Task 9: Discord event routing and mention handling

**Files:**
- Create: `src/discord/handlers.ts`
- Test: `tests/handlers.test.ts`

**Interfaces:**
- Consumes: discord.js message/interaction shapes through narrow structural
  types, `ConversationService`, `EventDeduplicator`, and command handler.
- Produces: `createDiscordHandlers(dependencies)` with `onMessageCreate` and
  `onInteractionCreate`.

- [ ] **Step 1: Write failing handler tests**

Verify messages from bots, DMs, non-mentions, empty prompts, disallowed channels,
missing permissions, and duplicate IDs are ignored or safely rejected. Verify a
valid mention removes only Jarvis's mention, treats a thread as its own
conversation, inherits persona from `parentId`, and uses safe chunked delivery.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/handlers.test.ts`

Expected: FAIL because handlers do not exist.

- [ ] **Step 3: Implement event routing**

Use only the `Guilds`, `GuildMessages`, and `MessageContent` gateway intents.
Check the bot's `ViewChannel`, `ReadMessageHistory`, and `SendMessages`
permissions before work. Use the Discord event ID for deduplication and never
log message content.

- [ ] **Step 4: Verify GREEN**

Run: `npm test -- tests/handlers.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/discord/handlers.ts tests/handlers.test.ts
git commit -m "feat: route Discord mentions and interactions"
```

### Task 10: Extension contracts, composition root, registration, and shutdown

**Files:**
- Create: `src/extensions/contracts.ts`
- Create: `src/utils/logger.ts`
- Create: `src/index.ts`
- Create: `scripts/register-commands.ts`
- Test: `tests/logger.test.ts`
- Test: `tests/application.test.ts`

**Interfaces:**
- Produces disabled contracts for GitHub read-only, MCP, repository context,
  PR summaries, recaps, gaming scores, images, and admin authorization.
- Produces no implementations or runtime tool registry entries.

- [ ] **Step 1: Write failing tests for logger redaction and shutdown seams**

Capture Pino output and assert configured keys and nested authorization headers
are redacted. Export `createApplication` with injectable Discord client,
storage, timers, and process-signal registration so tests can verify shutdown
closes storage, destroys Discord, and clears cleanup timers exactly once.

- [ ] **Step 2: Verify RED**

Run: `npm test -- tests/logger.test.ts tests/application.test.ts`

Expected: FAIL because composition and logger exports do not exist.

- [ ] **Step 3: Implement inert extension contracts and structured logger**

Interfaces expose capability metadata and read-only method signatures only.
There is no shell, filesystem, code-execution, Discord-admin, or GitHub-write
contract. Redact `token`, `apiKey`, `authorization`, and nested header variants.

- [ ] **Step 4: Implement application composition**

Load dotenv once, validate config, load the trusted persona, open SQLite, create
the OpenAI and Discord clients, bind handlers, schedule retention cleanup, and
login. Register `SIGINT` and `SIGTERM`; shutdown is idempotent and stops
accepting work before closing dependencies. On startup failure, close any
already-created resources and set a nonzero exit code.

- [ ] **Step 5: Implement development-guild registration**

Use `REST({ version: '10' })` and
`Routes.applicationGuildCommands(clientId, guildId)`. Require the validated
Discord token/client/guild values. Do not include or automatically call the
global route.

- [ ] **Step 6: Verify Task 10**

Run:

```powershell
npm test
npm run lint
npm run build
```

Expected: all commands exit 0 without credentials or network calls.

- [ ] **Step 7: Commit**

```powershell
git add src/extensions src/utils/logger.ts src/index.ts scripts/register-commands.ts tests
git commit -m "feat: compose Jarvis runtime safely"
```

### Task 11: Docker and operator documentation

**Files:**
- Create: `Dockerfile`
- Create: `docker-compose.yml`
- Create: `.dockerignore`
- Create: `README.md`
- Modify: `.gitignore`

**Interfaces:**
- Produces an unprivileged production image.
- Produces persistent `/app/data` storage and a read-only root filesystem in
  Compose.

- [ ] **Step 1: Write Docker configuration**

Use a Node 22 Debian slim multi-stage build so native SQLite binaries match the
runtime libc. Install with `npm ci`, build, run production install pruning dev
dependencies, create an unprivileged `jarvis` user, and copy only compiled
output, production dependencies, package metadata, and `config`.

Compose requirements:

```yaml
read_only: true
init: true
restart: unless-stopped
security_opt:
  - no-new-privileges:true
tmpfs:
  - /tmp
volumes:
  - jarvis-data:/app/data
```

Do not expose ports because the Discord gateway connection is outbound.

- [ ] **Step 2: Write the complete README**

Cover all 15 requested sections: architecture, prerequisites, Discord
application creation, bot user, minimum permissions, token, client/guild IDs,
OpenAI key, guild registration, local run, Docker run, security, troubleshooting,
cost controls, and extension points.

Include this invitation template without fabricated IDs:

```text
https://discord.com/oauth2/authorize?client_id=YOUR_DISCORD_CLIENT_ID&scope=bot%20applications.commands&permissions=REPLACE_WITH_CALCULATED_MINIMUM_PERMISSION_INTEGER
```

Explain calculating the permission integer in Discord's Developer Portal
instead of hardcoding a broad administrator value. Document that global command
registration requires deliberately changing the registration route and may
propagate slowly. Include immersive and restrained Jarvis examples, channel ID
mapping, data retention, and an explicit no-server-mutation guarantee.

- [ ] **Step 3: Validate docs and image locally**

Run:

```powershell
npm run format
npm run format:check
docker compose config
docker build -t jarvis-discord-bot:test .
```

Expected: formatting passes, Compose renders, and the image builds successfully.

- [ ] **Step 4: Commit**

```powershell
git add Dockerfile docker-compose.yml .dockerignore README.md .gitignore
git commit -m "docs: add secure deployment and setup guide"
```

### Task 12: Full verification and security closure

**Files:**
- Modify only files implicated by verified failures.
- Create security-scan artifacts only if required by the active security skill.

**Interfaces:**
- Produces evidence for formatting, lint, tests, build, dependency health,
  Docker configuration, and scoped security review.

- [ ] **Step 1: Run the clean verification suite**

```powershell
npm run format:check
npm run lint
npm test
npm run build
npm audit --omit=dev
docker compose config
docker build -t jarvis-discord-bot:test .
git diff --check
git status --short
```

Record exact exit codes and test counts. Do not claim success from earlier or
partial runs.

- [ ] **Step 2: Run the scoped security review**

Apply the `codex-security:security-scan` skill to the repository. Verify:

- no secrets are tracked or printed;
- Discord permissions cannot mutate server state;
- no tool, shell, filesystem, eval, or repository-write capability exists;
- SQL is parameterized and guild-scoped;
- logs omit message content;
- output disables mentions;
- configuration and persona paths cannot be influenced by Discord input;
- retries are bounded and do not retry permanent failures;
- maps, histories, responses, and timers are bounded;
- shutdown releases native database handles.

- [ ] **Step 3: Fix only validated findings test-first**

For each reportable finding, add a failing regression test, verify RED, make the
smallest fix, verify GREEN, then rerun the full suite.

- [ ] **Step 4: Request independent final review**

Dispatch a fresh review subagent with the approved spec, plan, repository diff,
and verification output. Require it to report requirement gaps, security risks,
and test weaknesses with file/line evidence. Resolve verified issues and close
the agent.

- [ ] **Step 5: Final commit**

If verification or review required changes:

```powershell
git add .
git commit -m "fix: close verification findings"
```

If the tree is already clean, create no empty commit.
