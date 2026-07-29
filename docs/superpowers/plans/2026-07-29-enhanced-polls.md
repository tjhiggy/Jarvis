# Enhanced Anonymous Polls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add administrator-created, durable, anonymous, single-choice Discord polls with live totals, automatic expiration, early closing, and restart recovery.

**Architecture:** A Discord-independent poll domain uses a replaceable `PollStore`, a transactional SQLite adapter, poll-scoped HMAC voter keys, and a keyed coordinator for ordered operations. A Discord gateway renders and edits only Jarvis-owned poll messages, while a controller coordinates domain transitions with Discord delivery and a scheduler closes, synchronizes, and cleans polls.

**Tech Stack:** TypeScript, Node.js 22+, discord.js 14, better-sqlite3, Zod, Pino, Vitest

## Global Constraints

- Poll creation and early closing require exact membership in `POLL_ADMIN_USER_IDS`; roles, guild ownership, and Discord permission claims do not authorize.
- Polls have 2 to 5 unique options, one choice per member, vote changes before close, live anonymous totals, and only the six approved duration presets.
- Raw voter IDs never enter poll storage or logs. Use `HMAC-SHA256(POLL_VOTER_SECRET, "<guild-id>:<poll-id>:<user-id>")`.
- Questions and option labels are untrusted text. Neutralize Discord mentions and set `allowedMentions: { parse: [], repliedUser: false }`.
- Add no gateway intents, moderation actions, role/channel/permission changes, message deletion, AI calls, web-search calls, or conversation-history writes.
- Poll Discord mutations are limited to creating and editing Jarvis-owned messages linked to stored poll records.
- Use parameterized SQL and a poll-specific additive migration ledger; do not alter or compete with the conversation store's `PRAGMA user_version`.
- Preserve the unrelated local infographic assets and all existing conversation data.
- Every task uses test-driven development and ends with focused tests, lint, formatting, and a bounded commit.

---

### Task 1: Poll configuration and slash-command contracts

**Files:**

- Modify: `src/config/config.ts`
- Modify: `src/commands/definitions.ts`
- Modify: `scripts/register-commands.ts`
- Create: `src/polls/poll-duration.ts`
- Modify: `.env.example`
- Modify: `tests/config.test.ts`
- Modify: `tests/commands.test.ts`
- Modify: `tests/register-commands.test.ts`

**Interfaces:**

- Consumes: existing `AppConfig`, `DiscordRegistrationConfig`, and `createCommandDefinitions(maxInputChars, faqEntries)`.
- Produces:

```ts
interface PollConfig {
  readonly enabled: boolean;
  readonly adminUserIds: ReadonlySet<string>;
  readonly voterSecret: string;
  readonly retentionDays: number;
  readonly expiryCheckSeconds: number;
}

type PollDurationValue = '15m' | '1h' | '6h' | '24h' | '3d' | '7d';
const pollDurationChoices: readonly {
  readonly name: string;
  readonly value: PollDurationValue;
}[];
function pollDurationMilliseconds(value: PollDurationValue): number;
```

- [ ] Add failing configuration tests for both-empty disabled configuration, fully configured enabled polls, one-sided partial configuration rejection, snowflake-only administrator IDs, a minimum 32-character secret, retention default `30`, and scheduler default `30`.
- [ ] Run `npx vitest run tests/config.test.ts` and confirm the new assertions fail.
- [ ] Create `poll-duration.ts` with the exact six values, visible names, and millisecond mappings: `15m=900000`, `1h=3600000`, `6h=21600000`, `24h=86400000`, `3d=259200000`, and `7d=604800000`.
- [ ] Add `POLL_ADMIN_USER_IDS`, `POLL_VOTER_SECRET`, `POLL_RETENTION_DAYS`, and `POLL_EXPIRY_CHECK_SECONDS` to the environment schema. Treat both credentials empty as disabled, exactly one as invalid, and return a frozen `config.polls` object.
- [ ] Extend registration configuration with `pollsEnabled: boolean` derived by the same two-credential rule. Never return the voter secret or administrator IDs from registration configuration.
- [ ] Add the four variables and safe comments to `.env.example`.
- [ ] Add failing command-definition tests for disabled registration retaining six commands and enabled registration adding `/poll` and `/poll-close`.
- [ ] Extend `createCommandDefinitions` to accept `pollsEnabled = false`. When enabled, define `/poll` with required `question`, `option1`, `option2`, and `duration`; optional `option3` through `option5`; and exact duration choices `15m`, `1h`, `6h`, `24h`, `3d`, `7d`. Define `/poll-close` with required `poll_id`.
- [ ] Bound `question` to 200 characters, options to 80, and `poll_id` to 12 in Discord definitions. Update command-name and option-type unions rather than casting.
- [ ] Update registration tests to prove enabled and disabled payloads without exposing poll credentials.
- [ ] Run `npx vitest run tests/config.test.ts tests/commands.test.ts tests/register-commands.test.ts`, then `npm run lint` and `npm run format:check`.
- [ ] Commit with `feat: configure enhanced poll commands`.

### Task 2: Poll domain values, validation, identity, and ordering

**Files:**

- Create: `src/polls/poll-types.ts`
- Create: `src/polls/poll-validation.ts`
- Create: `src/polls/poll-identity.ts`
- Create: `src/polls/poll-coordinator.ts`
- Create: `tests/poll-domain.test.ts`

**Interfaces:**

- Consumes: `PollDurationValue` and `pollDurationMilliseconds` from `src/polls/poll-duration.ts`.
- Produces:

```ts
type PollStatus = 'creating' | 'active' | 'closed' | 'orphaned' | 'failed';
type PollSyncState = 'pending' | 'synced' | 'orphaned';

interface PollOptionView {
  readonly index: number;
  readonly label: string;
  readonly voteCount: number;
}

interface PollView {
  readonly id: string;
  readonly guildId: string;
  readonly conversationId: string;
  readonly channelId: string;
  readonly parentChannelId?: string;
  readonly messageId?: string;
  readonly creatorUserId: string;
  readonly question: string;
  readonly status: PollStatus;
  readonly closesAt: Date;
  readonly closedAt?: Date;
  readonly syncState: PollSyncState;
  readonly options: readonly PollOptionView[];
}

function validatePollInput(input: {
  readonly question: string;
  readonly options: readonly string[];
  readonly duration: string;
}): {
  readonly question: string;
  readonly options: readonly string[];
  readonly duration: PollDurationValue;
  readonly durationMs: number;
};

function createPollId(randomBytes?: (size: number) => Uint8Array): string;
function createVoterKey(
  secret: string,
  guildId: string,
  pollId: string,
  userId: string,
): string;

interface PollCoordinator {
  run<T>(pollId: string, operation: () => Promise<T>): Promise<T>;
}
```

- [ ] Write failing table-driven tests for question and option Unicode lengths, trimming, 2-to-5 count, Unicode case-folded and collapsed-whitespace duplicates, and exact duration mappings.
- [ ] Add failing tests that generated IDs are exactly 12 lowercase Base32 characters and voter keys are stable within one poll but differ by user, poll, guild, or secret without containing input IDs.
- [ ] Add failing concurrency tests proving operations for one poll execute in submission order while different poll IDs may proceed independently and keyed state is released afterward.
- [ ] Run `npx vitest run tests/poll-domain.test.ts` and confirm missing-module failures.
- [ ] Implement immutable domain types, strict validation with Unicode code-point counts, duration mapping, cryptographic Base32 ID generation, HMAC-SHA256 voter keys, and a promise-chain keyed coordinator.
- [ ] Run `npx vitest run tests/poll-domain.test.ts`, then lint and format checks.
- [ ] Commit with `feat: add poll domain primitives`.

### Task 3: Replaceable poll storage and transactional SQLite adapter

**Files:**

- Create: `src/polls/poll-store.ts`
- Create: `src/polls/sqlite-poll-store.ts`
- Create: `tests/poll-storage.test.ts`

**Interfaces:**

- Consumes: domain types from Task 2.
- Produces:

```ts
interface PollStore {
  reserve(input: ReservePollInput): Promise<PollView>;
  activate(pollId: string, messageId: string): Promise<PollView>;
  markFailed(pollId: string): Promise<void>;
  recordVote(input: {
    readonly pollId: string;
    readonly voterKey: string;
    readonly optionIndex: number;
    readonly now: Date;
  }): Promise<{
    readonly kind: 'recorded' | 'changed' | 'unchanged';
    readonly poll: PollView;
  }>;
  close(pollId: string, now: Date): Promise<PollView>;
  closeDue(now: Date, limit: number): Promise<readonly PollView[]>;
  markPendingSync(pollId: string, nextSyncAt: Date): Promise<void>;
  markSynced(pollId: string): Promise<void>;
  markOrphaned(pollId: string): Promise<void>;
  listPendingSync(now: Date, limit: number): Promise<readonly PollView[]>;
  countActive(): Promise<number>;
  hasActiveByCreatorInConversation(
    creatorUserId: string,
    conversationId: string,
  ): Promise<boolean>;
  cleanup(cutoff: Date): Promise<number>;
  healthCheck(): Promise<boolean>;
  closeConnection(): Promise<void>;
}
```

- [ ] Write temporary-database tests for additive creation of `polls`, `poll_options`, `poll_votes`, and `poll_schema_migrations` without changing `PRAGMA user_version`.
- [ ] Add failing tests for reservation/activation, active counts, one-active-per-creator-conversation query, parameterized Unicode content, and complete view reconstruction.
- [ ] Add failing vote tests for initial, unchanged, and changed votes; exact aggregate counts; invalid options; expired or closed polls; and absence of raw user IDs.
- [ ] Add concurrent vote tests using two store calls and assert final counts cannot become negative or exceed participant totals.
- [ ] Add failing close tests proving idempotent final views and transactional deletion of voter rows while aggregate counts remain.
- [ ] Add close-due, pending-sync ordering, retry metadata, orphan, cleanup, health, and idempotent-close tests.
- [ ] Run `npx vitest run tests/poll-storage.test.ts` and confirm failures.
- [ ] Implement a dedicated better-sqlite3 connection with WAL, foreign keys, five-second busy timeout, parameterized prepared statements, domain transactions, and a `poll_schema_migrations` version row.
- [ ] Use status checks inside transactions so duplicate deliveries become idempotent and no caller may vote after `closes_at`.
- [ ] Run `npx vitest run tests/poll-storage.test.ts tests/storage.test.ts`, then lint, format, and build checks.
- [ ] Commit with `feat: persist anonymous poll state`.

### Task 4: Discord poll rendering and message gateway

**Files:**

- Create: `src/polls/poll-renderer.ts`
- Create: `src/polls/poll-message-gateway.ts`
- Create: `tests/poll-message-gateway.test.ts`

**Interfaces:**

- Consumes: `PollView`, `neutralizeDiscordMentions`, discord.js embed, button, and action-row builders.
- Produces:

```ts
interface PollMessageGateway {
  create(interaction: PollCreationTarget, poll: PollView): Promise<string>;
  update(poll: PollView): Promise<void>;
  markUnavailable(poll: PollView): Promise<void>;
}

interface PollCreationTarget {
  editReply(options: PollMessagePayload): Promise<unknown>;
  fetchReply(): Promise<Readonly<{ id: string }>>;
}

interface PollMessagePayload {
  readonly embeds: readonly unknown[];
  readonly components: readonly unknown[];
  readonly allowedMentions: Readonly<{
    parse: readonly [];
    repliedUser: false;
  }>;
}

type PollGatewayErrorCategory =
  'unknown-message' | 'permission' | 'rate-limit' | 'network' | 'service';
```

- [ ] Write failing renderer tests for 2 and 5 options, live counts, percentages, zero-vote percentages, total participation, Discord timestamp closing text, poll ID, and disabled closed buttons.
- [ ] Add tests proving question/option mentions are neutralized, controlled mentions are present, component IDs contain only version, poll ID, and option index, and embed/component limits are respected.
- [ ] Write gateway tests with fake interaction/channel message targets for public deferred creation, captured message ID, own-message update, unavailable rendering, and safe error categorization without content leakage.
- [ ] Run `npx vitest run tests/poll-message-gateway.test.ts` and confirm failures.
- [ ] Implement pure rendering separately from Discord I/O. Use one legacy action row with 2-to-5 buttons and no Components V2 flag, modals, collectors, reactions, or deletion.
- [ ] Map Discord error codes to the fixed categories and never include questions, options, raw response bodies, or credentials in thrown operational errors.
- [ ] Run the focused test, lint, format, and build checks.
- [ ] Commit with `feat: render safe Discord poll messages`.

### Task 5: Poll service and Discord orchestration

**Files:**

- Create: `src/polls/poll-service.ts`
- Create: `src/polls/poll-controller.ts`
- Create: `tests/poll-service.test.ts`
- Create: `tests/poll-controller.test.ts`

**Interfaces:**

- Consumes: `PollStore`, `PollCoordinator`, `PollMessageGateway`, validation, ID generation, voter-key generation, clock, logger.
- Produces:

```ts
interface PollService {
  reserve(request: CreatePollRequest): Promise<PollView>;
  activate(pollId: string, messageId: string): Promise<PollView>;
  vote(request: VoteRequest): Promise<VoteResult>;
  close(request: ClosePollRequest): Promise<PollView>;
  closeExpired(now: Date): Promise<readonly PollView[]>;
  cleanup(cutoff: Date): Promise<number>;
}

interface PollController {
  create(request: PollCreateInteractionRequest): Promise<void>;
  vote(request: PollVoteInteractionRequest): Promise<void>;
  close(request: PollCloseInteractionRequest): Promise<void>;
  synchronize(poll: PollView): Promise<void>;
}
```

- [ ] Write service tests for active-capacity 100, one-active-per-admin-conversation, creation-rate three per ten minutes, validated reservation, poll-scoped voter keys, ordered vote changes, idempotency, closing, expiration, and cleanup.
- [ ] Prove service requests and logs never contain raw voter IDs after the key boundary or poll text in telemetry.
- [ ] Write controller tests for create-reserve-message-activate ordering, public creation, private vote acknowledgements, live updates, early close, disabled final rendering, and no AI/search/conversation calls.
- [ ] Add failure tests: message creation marks failed; activation failure edits unavailable; update failure marks pending; unknown message marks orphaned; transient failures schedule exponential retry at 30, 60, 120, 240, and 480 seconds with a five-attempt cap.
- [ ] Run `npx vitest run tests/poll-service.test.ts tests/poll-controller.test.ts` and confirm failures.
- [ ] Implement the domain service and controller with no discord.js types crossing into `PollService`.
- [ ] Keep rate-limit accounting local and bounded, and inject clock/randomness for deterministic tests.
- [ ] Run focused tests, lint, format, and build checks.
- [ ] Commit with `feat: orchestrate durable poll voting`.

### Task 6: Route poll commands and component interactions

**Files:**

- Modify: `src/commands/handlers.ts`
- Modify: `src/discord/handlers.ts`
- Modify: `tests/commands.test.ts`
- Modify: `tests/handlers.test.ts`

**Interfaces:**

- Consumes: `PollController`, poll configuration, existing DM/allowlist and safe-reply helpers.
- Produces:

```ts
interface DiscordInteraction {
  isChatInputCommand(): boolean;
  isButton(): boolean;
}

function parsePollCustomId(
  customId: string,
): { readonly pollId: string; readonly optionIndex: number } | undefined;
```

- [ ] Extend test interaction fakes for string options, button custom IDs, message identity, private replies, deferred public replies, and edits.
- [ ] Add failing `/poll` tests for disabled polls, DM, unauthorized user, disallowed direct channel, allowed parent thread, input collection, duration choice, and safe errors.
- [ ] Add failing `/poll-close` tests for the same authorization boundary and exact poll ID forwarding.
- [ ] Add failing handler tests proving chat commands route to the existing command handler, valid `poll:v1` buttons route to the poll controller, malformed/non-poll buttons are ignored or privately rejected as designed, and mention events remain unchanged.
- [ ] Update `/help` and `/status` tests for administrator-only creation, anonymous voting, and configured/disabled poll readiness.
- [ ] Implement command routing without duplicating authorization logic: handlers enforce interaction shape and access; the controller enforces poll state and stored scope.
- [ ] Ensure button interactions validate stored guild, channel, and message identity before vote mutation.
- [ ] Run `npx vitest run tests/commands.test.ts tests/handlers.test.ts`, then lint, format, and build checks.
- [ ] Commit with `feat: handle poll commands and votes`.

### Task 7: Scheduler, startup lifecycle, and graceful shutdown

**Files:**

- Create: `src/polls/poll-scheduler.ts`
- Modify: `src/index.ts`
- Modify: `tests/application.test.ts`
- Create: `tests/poll-scheduler.test.ts`

**Interfaces:**

- Consumes: poll service/controller/store, `ApplicationTimers`, config, logger, Discord client.
- Produces:

```ts
interface PollScheduler {
  start(): void;
  runNow(): Promise<void>;
  stop(): Promise<void>;
  readonly healthy: boolean;
}
```

- [ ] Write scheduler tests for one tick at a time, overdue close, pending synchronization, retention cleanup, bounded batch sizes, error containment, health state, and `stop()` awaiting an active tick.
- [ ] Add application tests proving disabled polls create no poll store/scheduler, enabled polls open the same configured SQLite path, handlers become active only after login, and overdue work begins only after the client is ready.
- [ ] Add startup-failure tests for poll database migration errors with sanitized telemetry and cleanup of already-created resources.
- [ ] Add shutdown tests proving Jarvis stops accepting interactions, stops/awaits the scheduler, closes poll storage, closes conversation storage, and destroys Discord exactly once.
- [ ] Run focused tests and confirm failures.
- [ ] Implement default factories for SQLite poll storage, controller, and scheduler. Register both chat-input and button handling through the existing listener boundary.
- [ ] Start the scheduler after Discord login and handler construction. Stop it before database and client teardown.
- [ ] Run `npx vitest run tests/poll-scheduler.test.ts tests/application.test.ts tests/handlers.test.ts`, then the full test suite, lint, format, and build.
- [ ] Commit with `feat: run durable poll lifecycle`.

### Task 8: Documentation, release verification, and pull request

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/CONFIGURATION.md`
- Modify: `docs/DISCORD_SETUP.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/SECURITY_MODEL.md`
- Modify: `docs/TROUBLESHOOTING.md`
- Modify: `docs/ROADMAP.md`

**Interfaces:**

- Consumes: completed implementation and operator behavior.
- Produces: accurate operator documentation and a reviewed pull request for issue #26.

- [ ] Document `/poll`, `/poll-close`, administrator ID authorization, anonymous aggregate semantics, durations, vote changes, live results, HMAC privacy, retention, restart recovery, scheduler operation, and rollback.
- [ ] Document that Jarvis now creates and edits only its own poll messages while retaining the prohibition on roles, channels, permissions, moderation, member actions, server settings, arbitrary files, shell execution, and GitHub writes.
- [ ] Add all poll environment variables to configuration docs and explain both-empty disabled, one-sided invalid, rotation requiring active-poll closure, and no secret exposure.
- [ ] Update Discord setup with no-new-intent behavior and the existing minimum permissions. Explain that command registration mutates only the application command set.
- [ ] Add troubleshooting for invalid configuration, orphaned messages, expired buttons, database locks, permission loss, and synchronization retries without exposing poll text or voter data.
- [ ] Add an Unreleased changelog entry and mark issue #26 as implemented only after deployment.
- [ ] Run focused poll tests, then require this complete release gate:

```powershell
npm test
npm run lint
npm run format:check
npm run build
npm run docs:check
```

- [ ] Run `git diff --check`, inspect `git status --short` and `git diff --stat`, and review the branch for secrets, raw voter IDs, untrusted content in logs, absolute workstation paths, new intents, new privileges, message deletion, and unrelated infographic changes.
- [ ] Commit with `docs: document enhanced anonymous polls`.
- [ ] Push `codex/enhanced-polls` and create a draft pull request against `main` referencing issue #26. Do not deploy, register commands, close the issue, or mutate live Discord state before review and explicit approval.

## Definition of Done

- Configured administrators can create 2-to-5-option polls and close them early.
- Members can cast or change one anonymous vote and see live aggregate totals.
- Active polls, deadlines, counts, and private voter keys survive restarts.
- Closing deletes individual voter keys, disables buttons, and preserves final totals.
- Expiration, synchronization retry, orphan handling, retention, and shutdown are bounded and tested.
- No raw voter IDs enter poll storage or logs, and no poll path invokes AI, search, conversation history, moderation, or server administration.
- No new gateway intent or destructive Discord permission is required.
- All tests, lint, formatting, build, and documentation validation pass.
- The branch is committed, reviewed, pushed, and presented in a pull request; live registration and deployment remain explicitly separate.
