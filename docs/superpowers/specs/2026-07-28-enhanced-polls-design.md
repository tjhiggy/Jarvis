# Enhanced Polls Design

## Status

Approved in conversation on 2026-07-28. This design refines GitHub issue #26
into a bounded first release.

## Goal

Let explicitly configured Muthaship administrators create durable, anonymous,
single-choice polls that show live aggregate results, close automatically, and
survive Jarvis restarts without granting Jarvis moderation or server-management
authority.

## Product decisions

- Only explicitly configured Discord user IDs may create or close polls.
- Every poll has 2 to 5 options.
- Members receive one choice and may change it until the poll closes.
- Results are visible while voting is active.
- Public results contain totals and percentages, never voter identities.
- Poll duration is selected from 15 minutes, 1 hour, 6 hours, 24 hours, 3
  days, or 7 days.
- Authorized administrators may close a poll early.
- Creation uses one slash command rather than a modal or wizard.
- Voting uses custom Discord buttons backed by SQLite. Discord's native poll
  object is not used because this release requires application-controlled
  anonymity and lifecycle behavior.

## User experience

### Create

Jarvis registers:

```text
/poll question:<text> option1:<text> option2:<text> option3:<optional> option4:<optional> option5:<optional> duration:<preset>
```

An authorized administrator invokes the command in an allowed server channel
or thread. Jarvis validates and defers the interaction, then posts one public
poll message containing:

- the neutralized question
- one button for each option
- live anonymous counts and percentages
- total participation
- closing time
- a short random poll ID

The initial result is public. Any validation, authorization, or operational
failure is private.

### Vote

Selecting an option records or changes the member's vote. Jarvis responds
privately with either `Vote recorded.` or `Vote changed.` and updates the
public aggregate result. Selecting the current choice again is an idempotent
success and does not alter totals.

No command or component reveals who voted or which option a member selected.

### Close

Jarvis also registers:

```text
/poll-close poll_id:<id>
```

Only a configured poll administrator may use it. Closing freezes voting,
disables every option button, deletes individual voter-key rows, and updates
the existing poll message with final aggregate totals.

The scheduler performs the same transition when the selected duration expires.
An expired or closed button returns a private `This poll is closed.` response.

### Help and status

`/help` describes poll creation as administrator-only and voting as anonymous.
`/status` reports poll database and scheduler readiness without exposing
questions, options, votes, administrator IDs, paths, or secrets.

## Discord platform design

Each option is a Discord button in one action row. Discord permits up to five
buttons in an action row and returns the developer-defined `custom_id` with the
component interaction. The identifier format is versioned and bounded:

```text
poll:v1:<poll-id>:<option-index>
```

It contains no guild, channel, user, question, or option text. Unknown,
malformed, or unsupported identifiers receive a private generic rejection.

The first release uses legacy action rows with buttons because the existing
message content and embed delivery model remains supported and avoids the
irreversible Components V2 message flag. It does not introduce modals, select
menus, reactions, or component collectors.

No new gateway intent is required. Component clicks arrive through the
existing `interactionCreate` event. Jarvis needs only its current ability to
view the target channel, send messages, use application commands, and edit its
own messages.

Official references:

- <https://docs.discord.com/developers/components/reference>
- <https://docs.discord.com/developers/platform/interactions>

## Architecture

### Poll domain

`src/polls/poll-service.ts` owns validation-independent poll transitions:

```ts
interface PollService {
  create(request: CreatePollRequest): Promise<PollView>;
  vote(request: VoteRequest): Promise<VoteResult>;
  close(request: ClosePollRequest): Promise<PollView>;
  closeExpired(now: Date): Promise<readonly PollView[]>;
  cleanup(cutoff: Date): Promise<number>;
}
```

It depends on a poll store, voter-key generator, clock, ID generator, and a
per-poll operation coordinator. It does not depend on Discord types.

### Storage boundary

`src/polls/poll-store.ts` defines the replaceable persistence interface.
`src/polls/sqlite-poll-store.ts` provides the initial parameterized SQLite
implementation.

The store exposes complete domain operations rather than generic SQL-shaped
CRUD. Vote changes and count adjustments happen in one transaction. Closing a
poll, preserving final totals, and deleting its voter keys happen in one
transaction.

### Discord boundary

`src/polls/poll-message-gateway.ts` creates and edits only Jarvis-owned poll
messages. It renders bounded embeds and action rows, disables buttons for
closed polls, neutralizes mentions, and always sets controlled allowed
mentions.

Discord failures are mapped to content-free result categories. The gateway
does not delete messages, fetch arbitrary history, or edit messages that are
not linked to a stored poll created by this application.

### Coordinator

`src/polls/poll-coordinator.ts` serializes operations for each poll ID inside
the single Jarvis process. This prevents a slower edit containing older totals
from overwriting a newer public result after concurrent votes.

SQLite transactions remain the source of truth. The coordinator is ordering,
not persistence or authorization.

### Scheduler

`src/polls/poll-scheduler.ts` runs every configured interval, defaulting to 30
seconds. It:

1. Finds and transactionally closes due active polls.
2. Renders the final disabled result for each newly closed poll.
3. Retries poll messages marked as needing synchronization.
4. Cleans closed poll metadata older than the retention cutoff.

Only one scheduler tick may run at a time. Shutdown stops new ticks and awaits
the active tick before SQLite and Discord teardown.

## Data model

The existing SQLite database gains migrations for three tables.

### `polls`

- `id`: random opaque public poll ID
- `guild_id`
- `conversation_id`: channel or thread ID
- `channel_id`
- `parent_channel_id`: nullable thread parent
- `message_id`: nullable until the Discord message is created
- `creator_user_id`: configured administrator ID retained for audit
- `question`
- `status`: `creating`, `active`, `closed`, `orphaned`, or `failed`
- `closes_at`
- `closed_at`: nullable
- `created_at`
- `updated_at`
- `sync_state`: `pending`, `synced`, or `orphaned`
- `sync_attempts`
- `next_sync_at`: nullable

### `poll_options`

- `poll_id`
- `option_index`: 0 through 4
- `label`
- `vote_count`

The primary key is `(poll_id, option_index)`.

### `poll_votes`

- `poll_id`
- `voter_key`: poll-scoped HMAC-SHA256 voter identifier
- `option_index`
- `created_at`
- `updated_at`

The primary key is `(poll_id, voter_key)`. Raw voter IDs are never stored in
this table.

Foreign keys cascade from a poll to options and votes. All SQL values are
parameters. WAL mode and the existing busy timeout remain enabled.

## Privacy and retention

`POLL_VOTER_SECRET` is a dedicated high-entropy secret. The voter key is:

```text
HMAC-SHA256(POLL_VOTER_SECRET, "<guild-id>:<poll-id>:<user-id>")
```

Including the poll ID prevents correlation of one member's voter keys across
different polls. The secret is never logged or returned by status. Rotating it
invalidates the ability to recognize prior active votes, so rotation requires
closing active polls first.

Individual voter-key rows exist only while a poll is active. Closing deletes
them transactionally after their contribution is represented in aggregate
option counts.

Closed, failed, and orphaned poll metadata is retained for 30 days by default,
then removed automatically. The Discord message remains after database
cleanup. No poll data is sent to Ollama, OpenAI, Tavily, or another external
provider.

## Configuration

The feature adds:

```text
POLL_ADMIN_USER_IDS=
POLL_VOTER_SECRET=
POLL_RETENTION_DAYS=30
POLL_EXPIRY_CHECK_SECONDS=30
```

When enabled, `POLL_ADMIN_USER_IDS` is a comma-separated, non-empty set of
Discord snowflake IDs. It is the complete authorization source for `/poll` and
`/poll-close`. Discord role names, role IDs, server ownership, and claimed
administrator status do not grant access.

Polls are disabled only when both `POLL_ADMIN_USER_IDS` and
`POLL_VOTER_SECRET` are empty. Supplying exactly one is an invalid partial
configuration and fails startup with variable-name-only configuration errors.
Supplying both enables polls and requires a voter secret of at least 32
characters. Command registration applies the same enabled/disabled decision,
but never places the secret in a Discord payload. `/status` reports
`Polls: configured` or `Polls: disabled`, never partial values.

## Validation and resource limits

- Question: 1 to 200 Unicode characters after trimming
- Options: 2 to 5
- Option label: 1 to 80 Unicode characters after trimming
- Options must be unique after Unicode case folding and whitespace
  normalization
- Duration: one registered preset only
- Creation rate: three successful or attempted creations per administrator per
  ten-minute window
- One active-poll limit per administrator per channel or thread
- Maximum 100 active polls across the process
- Poll ID: 12 lowercase Base32 characters generated with a cryptographically
  secure source
- Custom ID: at most 100 characters and exactly the versioned format above

Questions and labels are untrusted data. Rendering neutralizes mass mentions,
user mentions, role mentions, and channel mentions and disables all parsed
mentions. No poll text becomes an AI instruction or conversation history.

## Authorization and channel access

Creation and closing require:

1. A server interaction, never a direct message.
2. Exact membership in `POLL_ADMIN_USER_IDS`.
3. Existing direct-channel or parent-thread allowlist access.
4. Jarvis permissions to view and send in the target channel.

Voting requires a server interaction on a stored active poll in the same guild,
channel, and message. The stored record, not the component payload, supplies
the authoritative scope.

The feature adds no role, channel, permission, member, webhook, moderation, or
server-setting action. Its only Discord mutations are creating and editing
Jarvis-owned poll messages and replying to interactions.

## State transitions and failure handling

### Creation

1. Validate authorization, scope, input, rate, and capacity.
2. Insert a `creating` poll and options transactionally.
3. Post the public Jarvis poll message and capture its message ID.
4. Activate and mark the poll synchronized.

If message creation fails, the reservation becomes `failed`. If persistence
fails after the Discord message exists, Jarvis edits its own message to a
disabled `Poll unavailable` state and records content-free telemetry. It does
not delete the message.

### Voting

The per-poll coordinator serializes vote handling. The store transaction:

1. Confirms active state and deadline.
2. Reads the prior option for the voter key.
3. Applies no change, an initial increment, or a decrement plus increment.
4. Returns a fresh aggregate snapshot.

Jarvis privately acknowledges the interaction, then edits the public message.
If the edit fails, the database stays authoritative and the poll is marked
pending for scheduler retry.

### Closing

Early and scheduled closes use the same idempotent store transition. A
duplicate close returns the existing final view. Buttons become disabled after
the public message synchronizes.

### Orphaned messages

Unknown-message responses from Discord mark the poll `orphaned` and stop
retries. Permission, network, and rate-limit failures use bounded exponential
backoff with at most five attempts. Logs include poll ID, guild/channel IDs,
operation, safe error category, and attempt count, but never question, option,
voter key, administrator list, or secret.

## Observability

Operational logs record:

- poll ID
- guild, channel, and conversation IDs
- operation: create, vote, close, synchronize, cleanup
- outcome category
- elapsed milliseconds
- aggregate participant count where useful

They never record poll text, option text, raw voter IDs, voter keys, secrets,
tokens, or component payloads.

`/status` performs poll-store health and scheduler-state checks without
querying or exposing poll content.

## Testing

Tests use fake Discord gateways and temporary SQLite databases. No Discord,
Ollama, OpenAI, or Tavily credential is required.

Coverage includes:

- configuration defaults, enablement, and secret validation
- exact administrator authorization
- server-only and channel/parent-thread allowlisting
- question, option, uniqueness, duration, capacity, and rate limits
- safe command definitions and duration choices
- successful public creation and captured message identity
- initial vote, repeat vote, and vote change
- live totals and percentages
- anonymous public rendering
- HMAC voter keys and absence of raw voter IDs
- concurrent clicks and ordered message edits
- duplicate delivery idempotency
- expiration and early closing
- deletion of voter keys on close
- restart recovery and overdue-poll closing
- bounded synchronization retries and orphan detection
- retention cleanup
- mention neutralization and controlled allowed mentions
- malformed and tampered component IDs
- database, Discord, authentication, permission, and rate-limit failures
- proof that poll paths never invoke conversation, AI, or web-search services
- graceful shutdown with an active scheduler tick

The release gate remains:

```powershell
npm test
npm run lint
npm run format:check
npm run build
npm run docs:check
```

## Deployment and rollback

Deployment adds SQLite tables through an additive migration. Existing
conversation data is unchanged.

After deployment, an authorized operator runs `npm run register-commands` once
to publish `/poll` and `/poll-close` to the development guild. Live validation
creates one short poll in an allowed test channel, casts and changes a vote,
closes it early, and confirms anonymous final totals.

Rollback:

1. Close active polls when practical.
2. Deploy the previous approved application version.
3. Re-register that version's command set.
4. Leave additive poll tables intact.

Rollback never deletes conversation or poll data automatically. Old poll
buttons safely fail once the previous application no longer recognizes their
component identifiers.

## Explicit non-goals

- polls created by regular members
- multiple-choice voting
- hidden-until-close results
- public or administrator voter lists
- role-based poll administration
- native Discord poll objects
- modals, wizards, select menus, or reactions
- editing a poll after creation
- reopening a closed poll
- deleting poll messages
- reminders or event RSVP behavior
- cross-guild polls
- AI-generated questions or options
- exports, analytics dashboards, leaderboards, or external integrations
- moderation, role management, channel management, or server settings
