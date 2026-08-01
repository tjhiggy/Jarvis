# Personal Reminders Design

**Issue:** #54
**Status:** Approved design

## Goal

Add durable personal reminders to Jarvis without granting moderation,
administrator, webhook, direct-message, or external-system authority. A user
creates a reminder in a server channel or thread; Jarvis later mentions that
same user in the same location.

## Scope

Version 1 provides:

- `/reminder set`
- `/reminder list`
- `/reminder cancel`
- relative delays measured in minutes, hours, or days
- SQLite persistence and restart recovery
- public delivery in the originating channel or thread
- private command confirmations and listings
- bounded retries, seven-day terminal-record retention, and health reporting

Version 1 does not provide recurring reminders, exact date/time scheduling,
timezones, direct messages, shared reminders, administrator-owned reminders,
administrator overrides, external delivery, or arbitrary scheduled jobs.
Those are separate backlog enhancements.

## User Experience

### Set

The command is:

```text
/reminder set in:<duration> message:<text>
```

Examples of valid durations are `10 minutes`, `2 hours`, and `3 days`.
Supported units may use singular or plural forms. The delay must be at least
one minute and no more than 30 days. Reminder text must contain between 1 and
500 characters after trimming.

Jarvis validates the request, stores the reminder, and returns an ephemeral
confirmation containing:

- the reminder ID;
- the due time rendered as a Discord timestamp;
- the originating channel or thread; and
- a reminder that delivery depends on Jarvis retaining access to that location.

At the due time Jarvis posts a public message in the original channel or
thread:

```text
<@owner> Reminder from 30 minutes ago: Check the oven
```

Only the reminder owner may be mentioned. User-supplied `@everyone`, `@here`,
role mentions, channel mentions, and user mentions are rendered inert.
Discord's allowed-mentions configuration permits only the verified owner ID.

If Jarvis was offline at the due time, the delivered message states the
approximate lateness rather than implying that it arrived on time.

### List

`/reminder list` returns an ephemeral list of reminders owned by the requesting
user in the current server. Each entry contains the reminder ID, shortened
text, due time, destination, and status. Output uses safe Discord chunking or
pagination when required.

The list may show active reminders and terminal reminders retained during the
seven-day troubleshooting window. It never exposes another user's reminder
text or metadata.

### Cancel

`/reminder cancel id:<reminder-id>` cancels only a reminder owned by the
requesting user. Cancellation is idempotent: cancelling an already-cancelled
reminder returns its current state without causing another mutation. Delivered,
failed, or expired records cannot be returned to an active state.

All set, list, cancel, validation, and error responses are ephemeral. Only the
scheduled reminder delivery is public.

## Limits and Authorization

- Maximum 10 active reminders per user across one Discord server.
- Minimum delay: one minute.
- Maximum delay: 30 days.
- Maximum reminder text: 500 characters.
- Existing guild-only and allowed-channel checks apply at creation.
- Delivery rechecks that the stored destination is still an allowed channel or
  a thread whose parent is allowed.
- Users can list and cancel only their own reminders.
- Version 1 has no administrator bypass or management command.
- Existing command rate limiting applies, with storage-level enforcement of
  the active-reminder cap.

The feature requires no additional Discord gateway intents. It uses the bot's
existing ability to view and send messages in explicitly allowed locations.

## Architecture

The reminder subsystem is isolated from conversation history and polls.

### ReminderStore

`ReminderStore` is a replaceable persistence interface. It supports:

- create with active-limit enforcement;
- list by guild and owner;
- get or cancel by guild, owner, and reminder ID;
- atomically claim a bounded batch of due reminders;
- record successful delivery;
- record permanent failure;
- schedule the next bounded retry;
- record delivery-uncertain state;
- recover abandoned claims after a lease timeout;
- remove terminal records older than seven days; and
- health and close operations.

`SqliteReminderStore` implements the interface with parameterized statements
and transactions. The interface must remain replaceable with PostgreSQL.

### ReminderService

`ReminderService` owns validation, duration parsing, authorization, active
limits, creation, listing, and cancellation. It does not call Discord directly.
Duration parsing is deterministic and does not use the AI provider.

### ReminderDeliveryGateway

`ReminderDeliveryGateway` resolves the stored channel or thread, rechecks the
allowlist, renders sanitized content, and creates one Jarvis-owned message. It
returns structured outcomes:

- delivered;
- transient failure;
- permanent missing destination;
- permanent permission failure; or
- uncertain delivery.

The gateway cannot edit or delete user content, create webhooks, send direct
messages, or change server resources.

### ReminderScheduler

`ReminderScheduler` runs in the single Jarvis process at a bounded interval and
processes a bounded batch. Only one tick may run at a time. It:

1. recovers claims whose lease expired;
2. atomically claims due reminders;
3. asks the delivery gateway to deliver each reminder;
4. records success, permanent failure, retry, or uncertainty;
5. removes terminal records older than seven days; and
6. updates content-free health state.

The scheduler starts only after the Discord client is ready. Shutdown prevents
new ticks and awaits any active tick before reminder storage closes.

Poll and reminder schedulers remain separate. They share lifecycle and logging
conventions, not tables or domain code.

## Data Model

Each reminder stores:

- opaque reminder ID;
- guild ID;
- destination channel or thread ID;
- optional parent channel ID used for allowlist revalidation;
- owner user ID;
- reminder text;
- due timestamp;
- status;
- attempt count;
- next-attempt timestamp;
- claim timestamp and lease identifier when claimed;
- created timestamp;
- delivered, cancelled, failed, or uncertain timestamp when applicable; and
- last safe failure category without raw Discord error content.

Statuses are:

- `pending`
- `claimed`
- `retry_pending`
- `delivery_uncertain`
- `delivered`
- `cancelled`
- `failed`

Active-limit calculations count `pending`, `claimed`, `retry_pending`, and
`delivery_uncertain`. Terminal records are `delivered`, `cancelled`, and
`failed`.

The schema uses indexes for due work, owner listings, active-limit checks, and
terminal cleanup. Schema initialization is additive and does not modify
conversation or poll rows.

## Delivery and Retry Semantics

Transient Discord or network failures retry at approximately:

1. one minute;
2. five minutes; and
3. fifteen minutes.

After the third unsuccessful retry, the reminder becomes `failed`. Missing
channels, deleted threads, disallowed destinations, and permanent permission
failures become `failed` without futile retries.

Delivery and state update cannot be one cross-system transaction. To reduce
duplicate messages:

- a reminder is claimed transactionally before Discord delivery;
- only the active lease may transition the record;
- confirmed Discord success is immediately persisted;
- an ambiguous result becomes `delivery_uncertain`;
- uncertain reminders are not blindly reposted;
- operator health reports expose the uncertain count without reminder content.

This favors avoiding duplicate public reminders over automatic redelivery when
the outcome cannot be proven.

## Privacy and Retention

Reminder text is untrusted user content. It is stored only to perform the
requested reminder and is never written to operational logs.

Delivered, cancelled, and failed records are retained for seven days, then
automatically deleted in bounded batches. `/reminder list` gives the owner
visibility during that window. Conversation `/forget` does not delete
reminders because reminders are a separate, explicit scheduled action.
Cancellation removes the future delivery obligation but retains the terminal
record until cleanup.

A future account-wide reminder-deletion command requires a separate design.

## Error Handling and Observability

Users receive safe errors for invalid duration, invalid text, active-limit
exhaustion, unknown reminder ID, unauthorized ownership, unavailable
destination, storage failure, and temporary service failure. Responses do not
expose database paths, Discord error bodies, stack traces, or configuration.

Operational logs include only:

- operation name;
- safe outcome category;
- elapsed time;
- batch counts;
- retry counts; and
- reminder-store or scheduler health.

Logs exclude reminder IDs when unnecessary, reminder text, user IDs, channel
IDs, guild IDs, tokens, and raw Discord payloads.

`/status` reports whether reminder storage and scheduling are configured and
healthy. It reports pending, retry, uncertain, and failed counts only when
those aggregate counts are safe and useful; it never reveals content or owner
information.

## Testing

Automated tests cover:

- duration parsing, singular/plural units, whitespace, and min/max boundaries;
- command definitions and ephemeral set/list/cancel responses;
- guild-only and allowed-channel enforcement;
- message length, active-limit, and ownership enforcement;
- cross-user list and cancellation isolation;
- parameterized SQLite creation, listing, claiming, cancellation, retries,
  uncertainty, cleanup, health, and close operations;
- one scheduler tick at a time and bounded batch processing;
- restart recovery and overdue delivery;
- retry timing and permanent-failure classification;
- claim-lease recovery and duplicate-delivery avoidance;
- thread parent allowlist revalidation;
- mass-mention and user-supplied-mention neutralization;
- owner-only allowed mentions;
- graceful shutdown ordering;
- `/status` health reporting; and
- application wiring with reminders enabled.

Discord calls are mocked. Tests require no live credentials and do not wait for
real clock time.

## Deployment and Rollback

Deployment requires explicit operator approval:

1. merge reviewed code;
2. stop Jarvis and back up SQLite plus companion files;
3. install dependencies and run the complete release gate;
4. build the approved revision;
5. register the changed guild commands once;
6. start exactly one Jarvis process;
7. create and receive a one-minute reminder in an allowed test channel;
8. verify listing, cancellation, restart recovery, and `/status`.

Rollback stops Jarvis, preserves the failed database as incident evidence,
deploys the prior approved revision, and re-registers its command set. Additive
reminder tables may remain unused during rollback; the database backup is
restored only if recovery requires it.

## Backlog Follow-ups

Create separate issues for:

- shared or administrator-created reminders;
- administrator reminder management with explicit opt-in;
- recurring reminders;
- exact date/time scheduling and per-user timezones;
- direct-message delivery and channel fallback;
- account-wide reminder deletion or export; and
- reminder delivery analytics that preserve user privacy.
