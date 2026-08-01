# Personal Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add durable, owner-only `/reminder set|list|cancel` commands that deliver a sanitized public reminder in the original allowed Discord channel or thread.

**Architecture:** A dedicated reminder domain uses a replaceable `ReminderStore`, an additive SQLite adapter, a deterministic service, an owner-only Discord delivery gateway, and a non-overlapping scheduler. The subsystem follows existing poll lifecycle patterns without sharing poll tables or domain code, and it adds no new Discord intents, administrator authority, or environment variables.

**Tech Stack:** TypeScript, Node.js 22+, discord.js 14, better-sqlite3, Vitest, ESLint, Prettier

## Global Constraints

- Personal reminders only; no shared, administrator, recurring, DM, exact-date, timezone, webhook, or external reminders.
- Delivery returns to the original allowed server channel or thread and mentions only the verified owner.
- Relative durations support singular or plural minutes, hours, and days from 1 minute through 30 days.
- Reminder text is 1 to 500 trimmed characters.
- Limit each user to 10 active reminders per guild.
- Set, list, cancel, validation, and error responses are ephemeral.
- Retry transient delivery failures after approximately 1, 5, and 15 minutes, then fail.
- Retain delivered, cancelled, and failed records for seven days, then remove them in bounded batches.
- Never log reminder text, user IDs, guild IDs, channel IDs, tokens, raw Discord payloads, or unsafe error bodies.
- Use parameterized SQLite statements and a dedicated `reminder_schema_migrations` table; do not change `PRAGMA user_version`.
- No post-generation AI call is involved. Reminder parsing and rendering are deterministic.
- No additional Discord gateway intents or server permissions.
- No deployment, command registration, issue closure, or live Discord mutation before merge and explicit operator approval.

---

## File Structure

Create focused reminder modules:

- `src/reminders/reminder-types.ts`: immutable domain views, statuses, delivery outcomes, and safe aggregate health counts.
- `src/reminders/reminder-duration.ts`: deterministic relative-duration parser and renderer.
- `src/reminders/reminder-identity.ts`: opaque 12-character reminder IDs and claim lease IDs.
- `src/reminders/reminder-store.ts`: replaceable persistence interface and typed domain errors.
- `src/reminders/sqlite-reminder-store.ts`: additive schema, transactions, claims, retries, cleanup, and health.
- `src/reminders/reminder-service.ts`: validation, rate limiting, ownership, creation, listing, and cancellation.
- `src/reminders/reminder-renderer.ts`: owner-only Discord payload and safe list/confirmation copy.
- `src/reminders/reminder-delivery-gateway.ts`: allowed-channel revalidation, Discord send, and error categorization.
- `src/reminders/reminder-scheduler.ts`: bounded non-overlapping recovery, delivery, retry, and cleanup loop.

Modify existing integration points:

- `src/commands/definitions.ts`: `/reminder` subcommands.
- `src/commands/handlers.ts`: ephemeral command controller, help, and status.
- `scripts/register-commands.ts`: register the always-enabled command.
- `src/index.ts`: storage, gateway, scheduler, handler, readiness, shutdown, and health wiring.
- `src/utils/mentions.ts`: neutralize Discord channel mentions as untrusted text.
- `README.md`, `CHANGELOG.md`, and operational/security/architecture/Discord documentation.

---

### Task 1: Reminder domain, duration parser, identity, and service

**Files:**

- Create: `src/reminders/reminder-types.ts`
- Create: `src/reminders/reminder-duration.ts`
- Create: `src/reminders/reminder-identity.ts`
- Create: `src/reminders/reminder-store.ts`
- Create: `src/reminders/reminder-service.ts`
- Create: `tests/reminder-duration.test.ts`
- Create: `tests/reminder-service.test.ts`

**Interfaces:**

- Produces:

```ts
export type ReminderStatus =
  | 'pending'
  | 'claimed'
  | 'retry_pending'
  | 'delivery_uncertain'
  | 'delivered'
  | 'cancelled'
  | 'failed';

export interface ReminderView {
  readonly id: string;
  readonly guildId: string;
  readonly channelId: string;
  readonly parentChannelId?: string;
  readonly ownerUserId: string;
  readonly message: string;
  readonly dueAt: Date;
  readonly status: ReminderStatus;
  readonly attemptCount: number;
  readonly nextAttemptAt?: Date;
  readonly createdAt: Date;
  readonly deliveredAt?: Date;
  readonly cancelledAt?: Date;
  readonly failedAt?: Date;
}

export interface ReminderStatusCounts {
  readonly pending: number;
  readonly retryPending: number;
  readonly deliveryUncertain: number;
  readonly failed: number;
}

export interface ParsedReminderDuration {
  readonly milliseconds: number;
  readonly canonical: string;
}

export const parseReminderDuration = (
  value: string,
): ParsedReminderDuration | undefined;

export const createReminderId = (randomBytes?: (size: number) => Buffer): string;
export const createReminderLeaseId = (
  randomBytes?: (size: number) => Buffer,
): string;
```

- Produces `ReminderStore`:

```ts
export interface CreateReminderInput {
  readonly id: string;
  readonly guildId: string;
  readonly channelId: string;
  readonly parentChannelId?: string;
  readonly ownerUserId: string;
  readonly message: string;
  readonly dueAt: Date;
  readonly createdAt: Date;
}

export interface ReminderStore {
  create(
    input: CreateReminderInput,
    activeLimit: number,
  ): Promise<ReminderView>;
  listByOwner(
    guildId: string,
    ownerUserId: string,
  ): Promise<readonly ReminderView[]>;
  cancelOwned(
    guildId: string,
    ownerUserId: string,
    reminderId: string,
    now: Date,
  ): Promise<ReminderView | undefined>;
  recoverExpiredClaims(leaseCutoff: Date, now: Date): Promise<number>;
  claimDue(
    now: Date,
    leaseId: string,
    limit: number,
  ): Promise<readonly ReminderView[]>;
  markDelivered(
    reminderId: string,
    leaseId: string,
    deliveredAt: Date,
  ): Promise<void>;
  markRetry(
    reminderId: string,
    leaseId: string,
    attemptCount: number,
    nextAttemptAt: Date,
    category: ReminderFailureCategory,
  ): Promise<void>;
  markFailed(
    reminderId: string,
    leaseId: string,
    failedAt: Date,
    category: ReminderFailureCategory,
  ): Promise<void>;
  markDeliveryUncertain(
    reminderId: string,
    leaseId: string,
    uncertainAt: Date,
  ): Promise<void>;
  cleanup(cutoff: Date, limit: number): Promise<number>;
  statusCounts(): Promise<ReminderStatusCounts>;
  healthCheck(): Promise<boolean>;
  closeConnection(): Promise<void>;
}

export type ReminderFailureCategory =
  'unknown-channel' | 'permission' | 'rate-limit' | 'network' | 'service';

export class ReminderActiveLimitError extends Error {}
export class ReminderStateConflictError extends Error {}

export type ReminderServiceErrorCode =
  'invalid-request' | 'rate-limit' | 'active-limit';

export class ReminderServiceError extends Error {
  readonly code: ReminderServiceErrorCode;
  readonly retryAfterMs?: number;
  constructor(code: ReminderServiceErrorCode, retryAfterMs?: number);
}
```

- Produces `ReminderService`:

```ts
export interface ReminderServiceDependencies {
  readonly store: ReminderStore;
  readonly rateLimiter: Pick<RateLimiter, 'consume'>;
  readonly now?: () => Date;
  readonly createId?: () => string;
  readonly activeLimit?: number;
}

export class ReminderService {
  set(request: {
    readonly guildId: string;
    readonly channelId: string;
    readonly parentChannelId?: string;
    readonly ownerUserId: string;
    readonly duration: string;
    readonly message: string;
  }): Promise<ReminderView>;
  list(request: {
    readonly guildId: string;
    readonly ownerUserId: string;
  }): Promise<readonly ReminderView[]>;
  cancel(request: {
    readonly guildId: string;
    readonly ownerUserId: string;
    readonly reminderId: string;
  }): Promise<ReminderView | undefined>;
}
```

- The service consumes one reminder-command rate-limit token keyed by
  `JSON.stringify([guildId, ownerUserId])` for set, list, and cancel.

- [ ] **Step 1: Write failing duration and identity tests**

```ts
it.each([
  ['1 minute', 60_000, '1 minute'],
  ['10 minutes', 600_000, '10 minutes'],
  ['2 hours', 7_200_000, '2 hours'],
  ['30 days', 2_592_000_000, '30 days'],
])('parses %s', (input, milliseconds, canonical) => {
  expect(parseReminderDuration(input)).toEqual({ milliseconds, canonical });
});

it.each(['59 seconds', '0 minutes', '31 days', 'tomorrow', '1.5 hours', ''])(
  'rejects unsupported duration %s',
  (input) => expect(parseReminderDuration(input)).toBeUndefined(),
);

expect(createReminderId(() => Buffer.alloc(16, 7))).toMatch(/^[a-z2-7]{12}$/);
```

- [ ] **Step 2: Run the new duration test and verify RED**

Run:

```powershell
npx vitest run tests/reminder-duration.test.ts
```

Expected: FAIL because reminder modules do not exist.

- [ ] **Step 3: Implement strict duration parsing and opaque IDs**

Parse with:

```ts
const durationPattern = /^([1-9]\d*)\s+(minute|minutes|hour|hours|day|days)$/i;
```

Convert using exact millisecond constants and reject results outside
`60_000..2_592_000_000`. Generate base32 IDs from cryptographic random bytes,
matching the poll identity safety pattern without importing poll domain code.

- [ ] **Step 4: Run duration tests and verify GREEN**

Run:

```powershell
npx vitest run tests/reminder-duration.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing service tests**

Cover:

```ts
it('trims, validates, rate-limits, and stores a personal reminder', async () => {
  const reminder = await service.set({
    guildId: 'guild-1',
    channelId: 'thread-1',
    parentChannelId: 'channel-1',
    ownerUserId: 'user-1',
    duration: '10 minutes',
    message: '  Check the oven  ',
  });
  expect(reminder.message).toBe('Check the oven');
  expect(reminder.dueAt.getTime()).toBe(now.getTime() + 600_000);
  expect(consumedKeys).toEqual([JSON.stringify(['guild-1', 'user-1'])]);
});
```

Also test empty/501-character messages, invalid identifiers, invalid duration,
store limit errors, owner-scoped list/cancel, idempotent cancellation, and
invalid clocks.

- [ ] **Step 6: Run the service tests and verify RED**

Run:

```powershell
npx vitest run tests/reminder-service.test.ts
```

Expected: FAIL because `ReminderService` is missing.

- [ ] **Step 7: Implement the minimal service and store contracts**

Normalize every identifier with `trim()`, copy all `Date` values, reject
invalid input with `ReminderServiceError('invalid-request')`, call the rate
limiter before storage, throw `ReminderServiceError('rate-limit')` when
`consume()` returns `allowed: false`, map `ReminderActiveLimitError` to
`ReminderServiceError('active-limit')`, and pass `activeLimit = 10` into
`store.create()`.

- [ ] **Step 8: Run focused tests and verify GREEN**

Run:

```powershell
npx vitest run tests/reminder-duration.test.ts tests/reminder-service.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

```powershell
git add src/reminders/reminder-types.ts src/reminders/reminder-duration.ts src/reminders/reminder-identity.ts src/reminders/reminder-store.ts src/reminders/reminder-service.ts tests/reminder-duration.test.ts tests/reminder-service.test.ts
git commit -m "feat: define personal reminder domain"
```

---

### Task 2: Transactional SQLite reminder storage

**Files:**

- Create: `src/reminders/sqlite-reminder-store.ts`
- Create: `tests/reminder-storage.test.ts`

**Interfaces:**

- Consumes `ReminderStore`, `CreateReminderInput`, `ReminderView`,
  `ReminderFailureCategory`, `ReminderStatusCounts`, and
  `ReminderActiveLimitError` from Task 1.
- Produces:

```ts
export class SQLiteReminderStore implements ReminderStore {
  constructor(databasePath: string);
}
```

- [ ] **Step 1: Write failing schema and creation tests**

Tests must prove:

- constructor creates the containing directory;
- schema uses `reminder_schema_migrations`, not `PRAGMA user_version`;
- opening the same database preserves an existing `user_version`;
- reminder creation is parameterized and round-trips every field;
- the eleventh active reminder for one guild/user throws
  `ReminderActiveLimitError`;
- a different user or guild has an independent active limit.

Use a temporary directory and real better-sqlite3 database. Do not mock SQL.

- [ ] **Step 2: Run storage tests and verify RED**

Run:

```powershell
npx vitest run tests/reminder-storage.test.ts
```

Expected: FAIL because `SQLiteReminderStore` is missing.

- [ ] **Step 3: Implement additive schema and create/list/cancel**

Create `reminders` with explicit checks and indexes:

```sql
CREATE TABLE reminders (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  parent_channel_id TEXT,
  owner_user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  due_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'pending', 'claimed', 'retry_pending', 'delivery_uncertain',
    'delivered', 'cancelled', 'failed'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  lease_id TEXT,
  claimed_at INTEGER,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER,
  cancelled_at INTEGER,
  failed_at INTEGER,
  uncertain_at INTEGER,
  failure_category TEXT,
  updated_at INTEGER NOT NULL
);
```

Configure WAL, foreign keys, busy timeout 5000, and synchronous NORMAL.
Create/list/cancel run in transactions where active counts and state changes
must be atomic.

- [ ] **Step 4: Add failing claim and transition tests**

Prove:

- `claimDue()` selects only pending/retry-due rows, ordered by due time and ID;
- batch size is honored;
- one lease owns each claim;
- `markDelivered`, `markRetry`, `markFailed`, and
  `markDeliveryUncertain` require the active lease;
- expired claims recover to retry-pending;
- uncertain records are never reclaimed automatically;
- terminal cleanup is bounded and seven-day cutoff compatible;
- status counts are aggregate-only;
- health and idempotent close work.

- [ ] **Step 5: Run storage tests and verify RED**

Run:

```powershell
npx vitest run tests/reminder-storage.test.ts
```

Expected: FAIL on missing claim/transition behavior.

- [ ] **Step 6: Implement claims, transitions, cleanup, and health**

Claim rows transactionally by selecting IDs and updating them to `claimed`
with one lease. Every post-delivery transition uses:

```sql
... WHERE id = ? AND status = 'claimed' AND lease_id = ?
```

Throw a content-free state-conflict error when the update count is not one.
Cleanup only `delivered`, `cancelled`, and `failed` records older than the
cutoff, using a bounded ID subquery.

- [ ] **Step 7: Run focused storage and service tests**

Run:

```powershell
npx vitest run tests/reminder-storage.test.ts tests/reminder-service.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```powershell
git add src/reminders/sqlite-reminder-store.ts tests/reminder-storage.test.ts
git commit -m "feat: persist personal reminders"
```

---

### Task 3: Safe rendering and owner-only Discord delivery

**Files:**

- Create: `src/reminders/reminder-renderer.ts`
- Create: `src/reminders/reminder-delivery-gateway.ts`
- Create: `tests/reminder-delivery-gateway.test.ts`
- Modify: `src/utils/mentions.ts`
- Modify: `tests/mentions.test.ts`

**Interfaces:**

- Consumes `ReminderView` and `ReminderFailureCategory`.
- Produces:

```ts
export interface ReminderMessagePayload {
  readonly content: string;
  readonly allowedMentions: Readonly<{
    readonly parse: readonly [];
    readonly users: readonly [string];
    readonly repliedUser: false;
  }>;
}

export type ReminderDeliveryOutcome =
  | Readonly<{ kind: 'delivered' }>
  | Readonly<{
      kind: 'transient-failure';
      category: 'rate-limit' | 'network' | 'service';
    }>
  | Readonly<{
      kind: 'permanent-failure';
      category: 'unknown-channel' | 'permission';
    }>
  | Readonly<{ kind: 'uncertain' }>;

export interface ReminderDeliveryGateway {
  deliver(reminder: ReminderView, now: Date): Promise<ReminderDeliveryOutcome>;
}

export interface DiscordReminderDeliveryGatewayDependencies {
  readonly allowedChannelIds: ReadonlySet<string>;
  readonly fetchChannel: (
    channelId: string,
  ) => Promise<ReminderDeliveryChannel | undefined>;
}
```

- `ReminderDeliveryChannel` exposes `id`, `guildId`, optional `parentId`, and
  `send(payload): Promise<unknown>`.

- [ ] **Step 1: Write failing mention and renderer tests**

Prove untrusted text neutralizes:

```text
@everyone @here <@123> <@!123> <@&456> <#789>
```

Prove rendered payload:

```ts
expect(payload.allowedMentions).toEqual({
  parse: [],
  users: ['owner-1'],
  repliedUser: false,
});
expect(payload.content).toContain('<@owner-1>');
expect(payload.content).not.toContain('<@&456>');
expect(payload.content).not.toContain('<#789>');
```

Test on-time and overdue wording without exposing internal timestamps.

- [ ] **Step 2: Run mention and gateway tests and verify RED**

Run:

```powershell
npx vitest run tests/mentions.test.ts tests/reminder-delivery-gateway.test.ts
```

Expected: FAIL because channel mentions are not neutralized and reminder
delivery modules are missing.

- [ ] **Step 3: Implement sanitizer and renderer**

Extend `neutralizeDiscordMentions()` to replace `<#digits>` alongside existing
mention forms. Render content under Discord's 2,000-character limit using the
500-character input bound. Permit only the stored owner ID in
`allowedMentions.users`.

- [ ] **Step 4: Write failing gateway behavior tests**

Cover:

- destination guild/channel identity mismatch;
- stored parent mismatch;
- allowed channel and allowed parent thread;
- disallowed destination;
- missing channel;
- permission, rate-limit, network, service, and ambiguous send errors;
- exactly one `send()` call with the owner-only payload.

- [ ] **Step 5: Implement the delivery gateway**

Revalidate with `isAllowedChannel(channel.id, channel.parentId,
allowedChannelIds)`. Categorize known pre-send lookup errors as permanent or
transient. Treat a rejected `send()` with a known pre-response Discord code as
typed failure; map genuinely ambiguous post-send outcomes to `uncertain`.
Never log or throw raw Discord error bodies.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```powershell
npx vitest run tests/mentions.test.ts tests/reminder-delivery-gateway.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```powershell
git add src/utils/mentions.ts src/reminders/reminder-renderer.ts src/reminders/reminder-delivery-gateway.ts tests/mentions.test.ts tests/reminder-delivery-gateway.test.ts
git commit -m "feat: deliver owner-only reminders safely"
```

---

### Task 4: Durable reminder scheduler

**Files:**

- Create: `src/reminders/reminder-scheduler.ts`
- Create: `tests/reminder-scheduler.test.ts`

**Interfaces:**

- Consumes `ReminderStore`, `ReminderDeliveryGateway`,
  `ReminderDeliveryOutcome`, `createReminderLeaseId`, and
  `OperationalLogger`.
- Produces:

```ts
export interface ReminderSchedulerDependencies {
  readonly store: ReminderStore;
  readonly gateway: ReminderDeliveryGateway;
  readonly intervalMs?: number;
  readonly batchSize?: number;
  readonly cleanupBatchSize?: number;
  readonly leaseTimeoutMs?: number;
  readonly retentionDays?: number;
  readonly retryDelaysMs?: readonly [number, number, number];
  readonly now?: () => Date;
  readonly createLeaseId?: () => string;
  readonly timers?: ReminderSchedulerTimers;
  readonly logger?: OperationalLogger;
}

export class ReminderScheduler {
  constructor(dependencies: ReminderSchedulerDependencies);
  get healthy(): boolean;
  start(): void;
  runNow(): Promise<void>;
  stop(): Promise<void>;
}
```

Defaults:

```ts
intervalMs = 30_000;
batchSize = 50;
cleanupBatchSize = 100;
leaseTimeoutMs = 5 * 60_000;
retentionDays = 7;
retryDelaysMs = [60_000, 300_000, 900_000];
```

- [ ] **Step 1: Write failing scheduler lifecycle tests**

Using injected timers and clocks, prove:

- start is idempotent and runs an immediate tick;
- overlapping `runNow()` calls share one active tick;
- stop clears the interval and awaits the tick;
- stopped schedulers reject new work;
- invalid numeric configuration is rejected.

- [ ] **Step 2: Run scheduler tests and verify RED**

Run:

```powershell
npx vitest run tests/reminder-scheduler.test.ts
```

Expected: FAIL because `ReminderScheduler` is missing.

- [ ] **Step 3: Implement scheduler lifecycle**

Follow the non-overlapping `PollScheduler` pattern, but keep reminder
dependencies and logs separate.

- [ ] **Step 4: Write failing outcome and recovery tests**

Prove each tick:

1. recovers expired claims;
2. claims one bounded due batch;
3. delivers sequentially;
4. marks delivered on success;
5. retries transient outcomes at 1, 5, and 15 minutes;
6. marks failed after the third retry or permanent failure;
7. marks ambiguous outcomes uncertain without reposting;
8. cleans terminal rows using the seven-day cutoff and cleanup batch;
9. contains individual reminder failures and continues the batch;
10. marks scheduler health degraded for storage or delivery-state failures;
11. logs only content-free counts and categories.

- [ ] **Step 5: Run scheduler tests and verify RED**

Run:

```powershell
npx vitest run tests/reminder-scheduler.test.ts
```

Expected: FAIL on unimplemented tick behavior.

- [ ] **Step 6: Implement bounded tick behavior**

Use one lease per claimed batch. Calculate next retry from the attempt number;
do not use `setTimeout()` per reminder. Persist each structured delivery
outcome immediately. Pass only operation names, safe categories, elapsed
values, and counts to the logger.

- [ ] **Step 7: Run scheduler and storage tests**

Run:

```powershell
npx vitest run tests/reminder-scheduler.test.ts tests/reminder-storage.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```powershell
git add src/reminders/reminder-scheduler.ts tests/reminder-scheduler.test.ts
git commit -m "feat: schedule durable reminder delivery"
```

---

### Task 5: `/reminder` commands, private UX, help, and status

**Files:**

- Modify: `src/commands/definitions.ts`
- Modify: `src/commands/handlers.ts`
- Modify: `scripts/register-commands.ts`
- Modify: `tests/commands.test.ts`
- Modify: `tests/register-commands.test.ts`

**Interfaces:**

- Consumes `ReminderService`, `ReminderStore.statusCounts/healthCheck`, and
  `ReminderScheduler.healthy`.
- Extends `CommandInteraction.options`:

```ts
readonly options: Readonly<{
  getSubcommand(): string;
  getString(name: string): string | null;
}>;
```

- Adds a Discord subcommand option union:

```ts
interface ReminderSubcommandDefinition {
  readonly type: 1;
  readonly name: 'set' | 'list' | 'cancel';
  readonly description: string;
  readonly options?: readonly ReminderStringOptionDefinition[];
}
```

- Adds `CommandDependencies.reminderService` and:

```ts
readonly reminderHealth: Readonly<{
  store: Pick<ReminderStore, 'healthCheck' | 'statusCounts'>;
  scheduler: Pick<ReminderScheduler, 'healthy'>;
}>;
```

- [ ] **Step 1: Write failing command-definition tests**

Assert `/reminder` is always registered with:

```text
set: required in string, max 64; required message string, max 500
list: no options
cancel: required id string, max 12
```

Assert command ordering and counts with polls disabled and enabled. Registration
must still target only the configured development guild.

- [ ] **Step 2: Run registration tests and verify RED**

Run:

```powershell
npx vitest run tests/register-commands.test.ts tests/commands.test.ts
```

Expected: FAIL because `/reminder` is absent.

- [ ] **Step 3: Implement command definitions**

Add `reminder` to the command-name union and add strongly typed subcommand
definitions. Do not introduce an enable flag or environment variable.

- [ ] **Step 4: Write failing handler tests**

Cover:

- DMs and disallowed channels are rejected ephemerally;
- `set`, `list`, and `cancel` always defer ephemerally;
- set passes guild/channel/parent/owner/duration/message exactly;
- list is guild and owner scoped;
- cancel uses the owner and validates the 12-character ID;
- typed invalid input, active limit, rate limit, ownership/not-found, and
  storage failures map to safe copy;
- list safely chunks long output and never exposes other users;
- help documents reminder limits;
- status reports reminder store/scheduler readiness and safe aggregate counts;
- status failure reports degraded without exposing internals.

- [ ] **Step 5: Run command tests and verify RED**

Run:

```powershell
npx vitest run tests/commands.test.ts
```

Expected: FAIL on missing handler behavior.

- [ ] **Step 6: Implement private reminder handlers**

Route all three subcommands through one allowed-channel scope helper. Use
`deferReply({ ephemeral: true })`. Render IDs, Discord timestamps, shortened
text, destination, and statuses deterministically. Use existing safe chunking
for list output. Do not route reminders through the AI conversation service.

- [ ] **Step 7: Remove the obsolete reminder refusal**

Modify:

- `src/security/unsupported-action-classifier.ts`
- `tests/conversation-service.test.ts`

Keep refusals for alarms, timers, scheduled emails, DMs, recaps, events, and
external messages. Stop claiming reminders are entirely unsupported. Natural
language such as “remind me” should direct the user to:

```text
Use /reminder set to create a personal reminder.
```

It must not create a reminder from free-form AI input.

- [ ] **Step 8: Run command, conversation, and registration tests**

Run:

```powershell
npx vitest run tests/commands.test.ts tests/conversation-service.test.ts tests/register-commands.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 5**

```powershell
git add src/commands/definitions.ts src/commands/handlers.ts scripts/register-commands.ts src/security/unsupported-action-classifier.ts tests/commands.test.ts tests/conversation-service.test.ts tests/register-commands.test.ts
git commit -m "feat: add personal reminder commands"
```

---

### Task 6: Application lifecycle and runtime wiring

**Files:**

- Modify: `src/index.ts`
- Modify: `tests/application.test.ts`

**Interfaces:**

- Consumes every reminder component from Tasks 1 through 5.
- Extends `ApplicationDependencies` with factories:

```ts
readonly createReminderStore?: (databasePath: string) => ReminderStore;
readonly createReminderGateway?: (dependencies: {
  client: RuntimeDiscordClient;
  allowedChannelIds: ReadonlySet<string>;
}) => ReminderDeliveryGateway;
readonly createReminderScheduler?: (
  dependencies: ReminderSchedulerDependencies,
) => ReminderScheduler;
```

- Extends the runtime Discord client with optional `channels.fetch()` through a
  narrow send-capable adapter. No new gateway intent.

- [ ] **Step 1: Write failing application construction tests**

Prove:

- reminder storage opens the configured `DATABASE_PATH`;
- one dedicated reminder command rate limiter uses the existing configured
  request count/window;
- gateway and scheduler are constructed only after successful Discord login;
- scheduler starts only after handlers are installed;
- handlers receive reminder service and health dependencies;
- startup recovery occurs through the first scheduler tick;
- no real credentials, Discord, clock waiting, or SQLite path are required.

- [ ] **Step 2: Run application tests and verify RED**

Run:

```powershell
npx vitest run tests/application.test.ts
```

Expected: FAIL because application dependencies are not wired.

- [ ] **Step 3: Implement runtime construction**

Open `SQLiteReminderStore` before login. After login, construct
`DiscordReminderDeliveryGateway` using `client.channels.fetch`, then construct
and start `ReminderScheduler`. Pass `ReminderService` into command handlers.
Keep reminder and poll factories independent.

- [ ] **Step 4: Write failing shutdown and startup-failure tests**

Prove shutdown order:

```text
stop accepting work
stop/await reminder scheduler
stop/await poll scheduler
close reminder store
close poll store
close conversation store
destroy Discord client
```

Prove repeated shutdown is idempotent and startup failure closes any reminder
resources already created.

- [ ] **Step 5: Implement graceful shutdown**

Each reminder shutdown error is logged with content-free application error
projection and does not prevent remaining resources from closing.

- [ ] **Step 6: Run application and reminder tests**

Run:

```powershell
npx vitest run tests/application.test.ts tests/reminder-scheduler.test.ts tests/commands.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```powershell
git add src/index.ts tests/application.test.ts
git commit -m "feat: wire reminder runtime lifecycle"
```

---

### Task 7: Documentation, backlog split, and release verification

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/CONFIGURATION.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/DISCORD_SETUP.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/SECURITY_MODEL.md`
- Modify: `docs/TROUBLESHOOTING.md`

**Interfaces:**

- Documents the exact command, limits, privacy, retention, retry, health,
  backup, registration, live test, and rollback behavior implemented in Tasks
  1 through 6.
- Creates separate GitHub backlog issues only after the code PR exists, for:
  shared/admin reminders, recurring reminders, exact time/timezones, DM
  delivery, and account-wide deletion/export. GitHub issue creation is a
  separate authorized repository action, not application runtime authority.

- [ ] **Step 1: Update user and administrator documentation**

Document:

- `/reminder set in:<duration> message:<text>`;
- `/reminder list`;
- `/reminder cancel id:<id>`;
- personal ownership and original-channel/thread delivery;
- 1 minute to 30 days, 500 characters, 10 active reminders;
- ephemeral command responses and owner-only public mention;
- `/forget` does not delete reminders;
- retries and seven-day retention;
- no DMs, recurring schedules, admin override, or extra Discord permissions.

- [ ] **Step 2: Update architecture and security documentation**

Document the dedicated store/service/gateway/scheduler, additive SQLite schema,
claim leases, uncertain delivery state, allowed-channel revalidation,
content-free logs, and shutdown ordering.

- [ ] **Step 3: Update operations, deployment, and troubleshooting**

Document:

- command registration is required after deployment;
- backup before upgrade;
- `/status` reminder health;
- one-minute controlled live test;
- missing-channel, permission, retry, uncertain, and duplicate-risk diagnosis;
- rollback to the prior revision and command set without deleting SQLite
  tables.

- [ ] **Step 4: Update changelog and roadmap**

Add personal reminders to Unreleased. Keep them out of Shipped until live
deployment verification. Move shared/admin, recurring, exact-time, DM, and
account-wide lifecycle features into explicit Later entries.

- [ ] **Step 5: Run focused reminder suite**

Run:

```powershell
npx vitest run tests/reminder-duration.test.ts tests/reminder-service.test.ts tests/reminder-storage.test.ts tests/reminder-delivery-gateway.test.ts tests/reminder-scheduler.test.ts tests/commands.test.ts tests/register-commands.test.ts tests/application.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run the complete release gate**

Run:

```powershell
npm test
npm run lint
npm run format:check
npm run build
npm run docs:check
git diff --check
```

Expected: all commands exit 0 with no warnings attributable to changed files.

- [ ] **Step 7: Perform the security and scope inspection**

Inspect `git status --short` and `git diff origin/main...HEAD`. Confirm:

- no secrets or real Discord IDs;
- no reminder content or identity logging;
- no new intents or administrator permissions;
- no DMs, webhooks, external delivery, arbitrary jobs, shell execution, file
  access, AI tool execution, or server-setting changes;
- no untracked infographic or user-owned asset changes;
- reminder mentions permit only the stored owner;
- every SQL value is parameterized;
- `/forget` and conversation retention remain unchanged.

- [ ] **Step 8: Commit documentation**

```powershell
git add README.md CHANGELOG.md docs/ARCHITECTURE.md docs/CONFIGURATION.md docs/DEPLOYMENT.md docs/DISCORD_SETUP.md docs/OPERATIONS.md docs/ROADMAP.md docs/SECURITY_MODEL.md docs/TROUBLESHOOTING.md
git commit -m "docs: document personal reminders"
```

- [ ] **Step 9: Independent final review**

Provide a reviewer with:

- approved design;
- this plan;
- `git diff origin/main...HEAD`;
- exact release-gate output.

Accept only concrete correctness, security, privacy, or scope findings. Allow
one bounded fix wave, then rerun the complete release gate.

- [ ] **Step 10: Push and open a draft pull request**

Push `codex/personal-reminders` and create a draft PR against `main` that
references issue #54. The PR body must summarize root behavior, security
boundaries, SQLite migration, tests, registration requirement, and live
rollout steps.

- [ ] **Step 11: Create deferred enhancement issues**

After the PR exists, create separate backlog issues for:

1. shared and administrator-created reminders;
2. recurring reminders;
3. exact date/time scheduling and per-user timezones;
4. DM delivery with channel fallback; and
5. account-wide reminder deletion/export.

Link each issue to #54 and the reminder PR. Do not close #54 until merged,
deployed, command registration succeeds, and the controlled live tests pass.

## Definition of Done

- `/reminder set`, `list`, and `cancel` are registered and work only in allowed
  server channels or threads.
- Every command response is ephemeral; scheduled delivery is public only in the
  originating location.
- Only the verified owner is mentioned, and user-supplied mentions are inert.
- Relative durations, text length, active limit, ownership, retries, retention,
  and cleanup match the approved design.
- Reminders survive restart, overdue reminders report lateness, and scheduler
  ticks do not overlap.
- Ambiguous delivery is not blindly repeated.
- `/status` reports safe reminder health.
- No new Discord intents, administrator authority, DMs, webhooks, or external
  systems are introduced.
- All tests, lint, formatting, build, documentation, and diff checks pass.
- The implementation is independently reviewed, pushed, and presented in a
  draft PR; deployment remains separate and requires explicit approval.
