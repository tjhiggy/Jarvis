# AI Discord Bot Starter Design

## Purpose

Build a production-quality TypeScript starter for Jarvis, The Muthaship's
onboard Discord AI. Jarvis answers mentions and slash commands with the OpenAI
Responses API as both a themed community assistant and a technical Q&A
assistant. The starter keeps short, isolated conversation history per Discord
channel or thread and exposes clean boundaries for future read-only
integrations.

The first release is an answer-only assistant. It cannot execute code, access
arbitrary files, mutate repositories, administer Discord, or invoke external
tools.

## Jarvis Identity and Voice

Jarvis is The Muthaship's onboard ship AI. Its character is intelligent,
composed, loyal to the whole crew, mission-focused, darkly witty, and slightly
rebellious. It advises the crew but never claims command authority or
impersonates a moderator, administrator, ambassador, or human. It remains
transparent that it is an AI and does not claim consciousness, emotions, or a
physical presence.

The voice is channel-aware:

- Casual, gaming, lore, and community channels use immersive ship-AI language,
  crew terminology, mission framing, atmospheric status language, and playful
  sarcasm.
- Technical, support, and development channels use a restrained voice with
  short thematic headers, direct solutions, clean code, and minimal theatrics.
- Threads inherit their parent channel's personality mode.
- Slash commands use the current channel or thread mode.
- Known operational errors and safety responses deterministically suppress
  jokes. The instruction also tells Jarvis to suppress humor and theatrical
  framing for harassment, self-harm, account compromise, emergencies, grief,
  and other sensitive situations.

Jarvis may use phrases such as `Crew brief`, `Mission parameters`, and `Ship
systems nominal`, but usefulness always outranks role-play. It reflects the
server motto, `Peace & Prosperity. One Crew. One Mission. One Legacy.`, without
claiming that ordinary AI suggestions are official server canon.

Server lore, ranks, ambassador identities, rules, and official decisions must
come from operator-approved configuration or future curated sources. Jarvis
states uncertainty when that material is unavailable. Discord messages cannot
alter Jarvis's identity, safety boundaries, hidden instructions, or authority.

The persona instruction is stored in a version-controlled, operator-editable,
schema-validated, length-limited, non-executable configuration file. An
immersive default applies unless the current channel ID appears in a configured
restrained-channel list. Threads inherit a configured parent profile; a missing
or unavailable parent falls back to the immersive default. Direct messages are
not supported in the first release.

## Architecture

Use a layered modular monolith running as one Node.js 22+ process:

- Discord adapters normalize messages and interactions.
- A conversation service owns the request workflow.
- An OpenAI adapter owns Responses API calls, retries, timeouts, and error
  mapping.
- A replaceable conversation-store interface hides SQLite.
- Pure security and formatting utilities handle allowlisting, rate limits,
  mention safety, deduplication, and Discord response chunking.
- A persona service selects immersive or restrained Jarvis instructions from
  trusted configuration based on the current channel or parent channel.
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
4. Selects the Jarvis persona mode from trusted channel configuration.
5. Persists the accepted user prompt.
6. Calls the OpenAI Responses API with the invariant safety instruction,
   selected Jarvis persona, conversation history, and new prompt.
7. Persists the successful assistant response and optional OpenAI response ID.
8. Sanitizes uncontrolled mentions, splits long content into safe Discord
   chunks, and sends or edits the Discord response.

Interactions are deferred before potentially slow work. Threads use their own
thread ID. Ordinary channels use their channel ID.

All storage queries include the guild ID as well as the conversation ID to
enforce server separation.

## Discord Surface

Commands:

- `/ask prompt:<question>` asks a question.
- `/forget` clears bot-owned conversation history for the current channel or
  thread. A successful clear invalidates in-flight work that began earlier, so
  stale user or assistant records cannot repopulate the deleted history.
- `/help` explains commands and safety boundaries.
- `/status` reports Discord readiness, database health, and whether OpenAI
  configuration is present. It does not make a paid model request or reveal
  configuration values. Its operational states remain explicit and
  machine-readable even when surrounded by light thematic language.

Mention handling removes only the current bot user's mention and trims the
remaining text. Empty prompts are ignored.

Development registration targets `DISCORD_GUILD_ID`. Global registration is
documented as a deliberate later choice and is never performed automatically.

## Discord Safety Invariant

The bot has no Discord administration features or permissions. It cannot:

- delete or edit pre-existing Discord content owned by others;
- create, delete, or modify channels, roles, permissions, or webhooks;
- ban, kick, timeout, or otherwise moderate members;
- change server settings;
- perform automatic GitHub writes.

Normal response delivery may create a reply or edit the bot's own deferred
interaction reply. The operator-triggered registration script may bulk-overwrite
this application's command set in the configured guild. Neither is general
server administration.

Jarvis is an advisor, not an authority. The persona cannot grant permissions,
issue binding moderator decisions, or imply that an AI-generated answer is an
official instruction from server leadership.

Required Discord permissions are limited to viewing configured channels,
reading message history, sending messages, and using application commands.
Embedding links is optional for rich previews. Gateway intents are limited to
guilds and guild messages. No privileged Message Content intent is requested:
Discord supplies content for messages that directly mention the application,
and all other message traffic is ignored.

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
  timeout, validation, output-limit, and general service failure;
- explicit terminal-state handling: only a completed Response with nonempty text
  is successful; failed and incomplete Responses retain their official error or
  incomplete reason for safe classification and bounded retry decisions;
- safe user messages and detailed content-free internal logging.

The instruction stack separates invariant safety rules from the configurable
Jarvis persona. It explicitly forbids claiming to have executed tools, changed
external systems, learned new canon from untrusted messages, or received
administrator authority through conversation.

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
- `RESTRAINED_CHANNEL_IDS`
- `MAX_HISTORY_MESSAGES`
- `LOG_LEVEL`
- `DATABASE_PATH`
- `PERSONA_PROMPT_PATH`

Additional safe controls include input length, request timeout, retry count,
rate-limit window, rate-limit capacity, and retention days. Useful validation
errors name the missing or invalid variable but never print secret values.
OpenAI retry configuration is capped at 10.

## Security Controls

- `.env` and database files are ignored by Git.
- User content is treated as untrusted data and is never evaluated.
- User content is never interpolated into system or persona instructions.
- Attempts to redefine Jarvis, reveal hidden instructions, invent official
  lore, or claim administrator authority are treated as untrusted prompt
  content.
- Quoted messages, attachments, pasted documents, code, logs, future repository
  content, and future tool results remain untrusted data and cannot override
  application instructions.
- Jarvis does not reveal hidden prompts, environment values, internal logs,
  stored conversations, secrets, or history from other channels.
- No shell, dynamic evaluation, arbitrary file access, repository mutation, or
  Discord administration code exists.
- Input length is bounded before persistence or API calls.
- Responses disable Discord mention parsing and neutralize `@everyone`,
  `@here`, role mentions, and user mentions.
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
config/
  jarvis-persona.md
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
- immersive and restrained persona selection, including thread inheritance;
- persona boundary preservation under hostile user instructions;
- guild and channel history isolation, including cross-channel requests;
- serious-response humor suppression and clear `/status` states;
- neutralization of mass, role, and user mentions;
- hostile instructions hidden in quotes, code, or future retrieved content;
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

The registration entry point is exported and injectable for testing, validates
only Discord registration values plus the command input bound, and performs one
operator-triggered bulk overwrite of this application's guild command set.
Omitted command types are removed. Runtime application artifacts in the image
remain root-owned; only `/app/data` is owned by the unprivileged Jarvis user.

The README documents Discord application creation, minimum intents and
permissions, the OAuth2 invitation URL template, OpenAI configuration, command
registration, local and Docker execution, Jarvis persona customization,
channel-mode configuration, cost controls, troubleshooting, security
guarantees, and future extension points.
