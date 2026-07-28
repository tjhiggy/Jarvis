# AI Discord Bot Starter Design

## Purpose

Build a production-quality TypeScript starter for a Discord bot that answers
mentions and slash commands with the OpenAI Responses API. The starter keeps
short, isolated conversation history per Discord channel or thread and exposes
clean boundaries for future read-only integrations.

The first release is an answer-only assistant. It cannot execute code, access
arbitrary files, mutate repositories, administer Discord, or invoke external
tools.

## Architecture

Use a layered modular monolith running as one Node.js 22+ process:

- Discord adapters normalize messages and interactions.
- A conversation service owns the request workflow.
- An OpenAI adapter owns Responses API calls, retries, timeouts, and error
  mapping.
- A replaceable conversation-store interface hides SQLite.
- Pure security and formatting utilities handle allowlisting, rate limits,
  mention safety, deduplication, and Discord response chunking.
- Inert extension interfaces describe future capabilities without granting
  them.

This keeps deployment simple while preserving boundaries that can later be
split into workers or backed by PostgreSQL.

## Request Flow

Both `/ask` and bot mentions become a normalized request containing guild ID,
channel or thread ID, user ID, Discord event ID, and prompt.

The pipeline:

1. Rejects bot-authored, duplicate, empty, oversized, disallowed-channel, or
   unauthorized requests.
2. Applies a basic per-user rate limit.
3. Loads the newest configured number of conversation records for the current
   channel or thread and restores chronological order.
4. Persists the accepted user prompt.
5. Calls the OpenAI Responses API with a fixed technical-assistant instruction,
   conversation history, and the new prompt.
6. Persists the successful assistant response and optional OpenAI response ID.
7. Sanitizes uncontrolled mentions, splits long content into safe Discord
   chunks, and sends or edits the Discord response.

Interactions are deferred before potentially slow work. Threads use their own
thread ID. Ordinary channels use their channel ID.

## Discord Surface

Commands:

- `/ask prompt:<question>` asks a question.
- `/forget` clears bot-owned conversation history for the current channel or
  thread.
- `/help` explains commands and safety boundaries.
- `/status` reports Discord readiness, database health, and whether OpenAI
  configuration is present. It does not make a paid model request or reveal
  configuration values.

Mention handling removes only the current bot user's mention and trims the
remaining text. Empty prompts are ignored.

Development registration targets `DISCORD_GUILD_ID`. Global registration is
documented as a deliberate later choice and is never performed automatically.

## Discord Safety Invariant

The bot has no Discord administration features or permissions. It cannot:

- delete or edit Discord messages;
- create, delete, or modify channels, roles, permissions, or webhooks;
- ban, kick, timeout, or otherwise moderate members;
- change server settings;
- perform automatic GitHub writes.

Required Discord permissions are limited to viewing configured channels,
reading message history, sending messages, embedding links, and using
application commands. Gateway intents are limited to guilds, guild messages,
and message content because mention handling requires message text.

The only destructive behavior is deletion of bot-owned SQLite history through
`/forget` and retention cleanup. Neither operation touches Discord content or
server configuration.

## OpenAI Integration

Use the official OpenAI Node SDK and `client.responses.create`. The model is
read from `OPENAI_MODEL`; its documented default lives in configuration and
`.env.example`, not in request handlers.

The adapter has:

- an abortable request timeout;
- bounded retries with exponential backoff and jitter for rate limits,
  transient network errors, and eligible 5xx failures;
- no retry for authentication, quota, validation, or safety rejection;
- typed internal errors for authentication, quota, rate limiting, safety,
  timeout, and general service failure;
- safe user messages and detailed content-free internal logging.

The system instruction defines a helpful technical assistant and explicitly
forbids claiming to have executed tools or changed external systems.

## Storage

SQLite records:

- Discord guild ID;
- channel or thread ID;
- Discord user ID;
- role (`user` or `assistant`);
- message content;
- timestamp;
- optional OpenAI response ID.

All SQL uses parameters. Schema migration is tracked with SQLite
`user_version`. History queries take the newest `MAX_HISTORY_MESSAGES` records
and return them chronologically. A configurable retention period defaults to
30 days; cleanup runs at startup and on a bounded interval.

`ConversationStore` is asynchronous even if the initial SQLite driver is
synchronous, allowing a PostgreSQL implementation later without changing
services or handlers.

## Configuration

Startup validates:

- `DISCORD_TOKEN`
- `DISCORD_CLIENT_ID`
- `DISCORD_GUILD_ID`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `ALLOWED_CHANNEL_IDS`
- `MAX_HISTORY_MESSAGES`
- `LOG_LEVEL`
- `DATABASE_PATH`

Additional safe controls include input length, request timeout, retry count,
rate-limit window, rate-limit capacity, and retention days. Useful validation
errors name the missing or invalid variable but never print secret values.

## Security Controls

- `.env` and database files are ignored by Git.
- User content is treated as untrusted data and is never evaluated.
- No shell, dynamic evaluation, arbitrary file access, repository mutation, or
  Discord administration code exists.
- Input length is bounded before persistence or API calls.
- Responses disable Discord mention parsing and neutralize `@everyone` and
  `@here`.
- Duplicate Discord event IDs are suppressed with a bounded TTL cache.
- Per-user rate limiting is scoped by guild and user.
- Channel allowlisting is enforced when configured.
- Logs include IDs, durations, and error classes, never prompt/response bodies,
  credentials, or authorization headers.
- Shutdown stops new work, clears timers, destroys the Discord client, and
  closes SQLite.
- Docker runs as an unprivileged user with only the data directory writable.

## Response Chunking

Discord responses are split below the platform limit with a safety margin.
Chunking prefers paragraph and line boundaries. When a fenced code block spans
chunks, each chunk closes and reopens the fence with its language marker when
reasonably possible. Delivery always disables allowed mentions.

## Project Layout

```text
src/
  commands/
  config/
  discord/
  extensions/
  openai/
  security/
  services/
  storage/
  utils/
  index.ts
scripts/
  register-commands.ts
tests/
docs/
  superpowers/specs/
```

Root files include `.env.example`, `.gitignore`, `Dockerfile`,
`docker-compose.yml`, `README.md`, `package.json`, `tsconfig.json`,
`eslint.config.js`, and Prettier configuration.

## Testing Strategy

Vitest tests cover:

- configuration validation;
- mention removal;
- Discord response chunking, including fenced code;
- per-user rate limiting;
- deterministic history truncation;
- real SQLite operations with temporary databases;
- OpenAI error mapping and retry eligibility with a mocked SDK boundary;
- `/forget` behavior with mocked Discord and storage boundaries.

Discord and OpenAI tests require no real credentials. Storage tests use real
temporary SQLite databases. Final verification runs formatting checks, lint,
the full test suite, TypeScript build, dependency audit, and a scoped security
review.

## Extension Interfaces

The starter defines disabled-by-default contracts for:

- GitHub read-only queries;
- MCP clients and tool discovery;
- repository-aware code context;
- pull-request summaries;
- scheduled weekly Discord recaps;
- gaming score tracking;
- image-generation requests;
- administrator-only command authorization.

No concrete implementations, credentials, schedules, tool execution, or write
capabilities are included. The recommended next step after the starter is a
read-only GitHub provider with explicit repository allowlisting and no token
write scopes.

## Operations

Local development uses `tsx`; production runs compiled JavaScript. A
guild-scoped registration script provides fast command iteration. Docker
Compose mounts a persistent data volume and reads local environment values
without baking secrets into the image.

The README documents Discord application creation, minimum intents and
permissions, the OAuth2 invitation URL template, OpenAI configuration, command
registration, local and Docker execution, cost controls, troubleshooting,
security guarantees, and future extension points.

