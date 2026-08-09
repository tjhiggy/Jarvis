# Engagement V1 runbook

This is the operating contract for the implemented, unreleased MuthaShip
engagement features.
Run exactly one Jarvis process against one SQLite database. Two workers sharing
a database do not provide high availability. They provide duplicate delivery.

## Boundaries and dependencies

Engagement state is local SQLite at `DATABASE_PATH`. Jarvis uses Discord's
outbound Gateway and REST calls only for interaction replies and messages it
owns. It has no inbound web port, cloud database, queue, webhook, or
write-capable external integration. Trivia questions are checked-in local
content; OpenAI, Ollama, Tavily, and Sleeper are not engagement dependencies.

Jarvis does not change roles, permissions, channels, server settings,
membership, or other users' content. It does not create GitHub issues or make
another external write. `npm run register-commands` is a deliberate operator
action that replaces only this application's command set in its configured
development guild, not a runtime server-settings change.

## Enablement and least privilege

1. Leave `ENGAGEMENT_ENABLED=false` until each destination channel and
   `ENGAGEMENT_ADMIN_ROLE_IDS` are known.
2. Set `ENGAGEMENT_ENABLED=true`, at least one feature channel, and at least
   one administrator role ID. Restart. Startup rejects enabled engagement
   without both a channel and administrator role.
3. Grant the bot **View Channel**, **Read Message History**, **Send Messages**,
   and **Embed Links** in every configured engagement channel. Members need
   **Use Application Commands**. No privileged intent or Administrator
   permission is required.
4. Run `npm run register-commands` after a deployment that changes command
   definitions. An administrator verifies `/engagement status` privately.

Each non-blank channel is a separate allowlist. A feature whose channel is
blank is unavailable. `ALLOWED_CHANNEL_IDS` never authorizes engagement to
read general chat.

| Key                                  | Valid value and effect                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| `ENGAGEMENT_ENABLED`                 | `true` enables configured features; blank or `false` disables them.              |
| `ENGAGEMENT_INTRODUCTION_CHANNEL_ID` | Sole destination for introduction cards.                                         |
| `ENGAGEMENT_SUGGESTION_CHANNEL_ID`   | Sole destination for suggestion cards and controls.                              |
| `ENGAGEMENT_EVENT_CHANNEL_ID`        | Sole destination for event cards and RSVP controls.                              |
| `ENGAGEMENT_RECAP_CHANNEL_ID`        | Sole destination for weekly recaps.                                              |
| `ENGAGEMENT_ACTIVITY_CHANNEL_ID`     | Sole destination for trivia cards and answers.                                   |
| `ENGAGEMENT_ADMIN_ROLE_IDS`          | Comma-separated app authorization allowlist. It grants no Discord permission.    |
| `ENGAGEMENT_RECAP_SCHEDULE`          | Optional `DAY HH:MM`, for example `MONDAY 09:30`; required for scheduled recaps. |
| `ENGAGEMENT_RECAP_TIMEZONE`          | Valid IANA timezone, default `UTC`.                                              |
| `ENGAGEMENT_RETENTION_DAYS`          | Integer 1 through 90, default 30.                                                |
| `ENGAGEMENT_MAX_RECORDS_PER_USER`    | Integer 1 through 25, default 5.                                                 |
| `ENGAGEMENT_MAX_PARTICIPANTS`        | Integer 2 through 1000, default 100.                                             |

## Commands, data, deletion

All command acknowledgements and failures are ephemeral unless Jarvis is
deliberately posting a card it owns. Commands are server-only. Guild, channel,
owner, expiry, capacity, and idempotency checks occur before a state change.

| Surface                                                       | Access and resulting local record                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/introduce preview`, `confirm`, `cancel`; `/introduction id` | Any member. Private previews are memory-only; confirmation stores record/guild/channel/owner IDs, name, interests, aboard text, status, message ID, and timestamps. Owner deletion removes the active row and bot-owned card.                                                                           |
| `/suggest preview`, `confirm`, `cancel`; `/suggestion delete` | Any member. Private previews are memory-only; confirmation stores IDs, title, description, status, message ID, and timestamps. Owner deletion works only before triage. Administrators may acknowledge, defer, resolve, or archive bot-owned cards, never create a GitHub issue.                        |
| `/event create`, `list`, `details`, `cancel`                  | Create/cancel require administrator roles. Create needs only title, description, and local start time by default. Timezone defaults to `America/New_York` and capacity to 20; both may be overridden, with an optional end time. Events store IDs, title, description, start/end, timezone, capacity, status, message ID, destination-missed flag, and timestamps. RSVPs store event/guild/user IDs, yes/maybe/no response, confirmed/waitlisted attendance, reminder opt-in, and timestamps. |
| `/recap preview`, `enable`, `pause`, `resume`                 | Administrator role. Stores guild recap state, run key/lease, and timestamps. Source is aggregate configured engagement data and Jarvis-owned activity, never historical chat or names.                                                                                                                  |
| `/trivia start`, `opt-out`, `opt-in`                          | Start only in the activity channel; preference commands work in any server channel. Stores curated question ID, round IDs, status, expiry/timestamps, participant ID, and correctness. It never retains answer text.                                                                                    |
| `/engagement status`, `pause`, `resume`, `delete`             | Status/pause/resume need administrator roles. Anyone deletes their own retained guild data; an administrator may supply `user_id`. Pause audit holds only guild ID, actor ID, operation, and timestamp. Status returns aggregates and health, never content or secrets.                                 |

An RSVP is opt-in for its event; a reminder requires the extra reminder opt-in.
Trivia opt-out deletes retained trivia participation and blocks future activity
until opt-in. `/engagement delete` is the broader guild-scoped deletion path.
Backups remain historical copies until they expire under the backup policy.

## Retention, schedulers, and failure response

`ENGAGEMENT_RETENTION_DAYS` governs normal cleanup of disposable local engagement state:
introductions, suggestions, expired trivia records and answers,
idempotency keys, completed recap run leases,
and pause/resume audit markers. Active opt-outs, recap preferences, and guild
pause preferences are never age-expired; they change only through explicit
opt-in/resume controls. Completed or cancelled events older than the
cutoff are removed with their RSVP rows by SQLite cascade; old orphaned RSVP
rows are also removed defensively. The batch limit bounds root rows selected by
cleanup; deleting one expired event may also cascade all of that event's RSVP
rows. Cleanup does not export data. Introduction/suggestion expiry and owner or
administrator deletion durably queue cleanup, delete the bot-owned card first,
and remove content rows only after that succeeds. A Discord deletion failure remains `cleanup_pending` for
retry.

| Scheduler             | Cadence                         | Failure behavior                                                                                                                                                                                                    |
| --------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event reminders       | 60 seconds                      | Claims at most 100 due reminders by lease. Paused guilds are skipped; failed delivery is content-free logged and marked failed, not duplicate-posted.                                                               |
| Weekly recap          | 60 seconds                      | Runs only when schedule, recap enablement, and engagement state permit it. A lease keyed to the configured local weekly slot prevents duplicates across UTC midnight and DST; unavailable source publishes nothing. |
| Trivia expiry/results | 15 seconds                      | Claims expired rounds and posts one aggregate card. Per-round failure is content-free logged, marks scheduler health degraded, and backs off before retry; a paused guild releases without posting.                 |
| Cleanup/recovery      | Startup and bounded maintenance | Deletes expired state and retries `cleanup_pending` Jarvis-owned cards.                                                                                                                                             |

`/engagement pause` persists a guild pause for recap, event-reminder, and
trivia-result delivery. It does not delete data, close a round, unregister
commands, or block member deletion. `/recap pause` affects recaps only.
The pause persists across retention cleanup and restarts until an explicit
`/engagement resume`.

Deletion responses distinguish records removed during the request from
card-backed records still queued for retry. Generic retention never removes an
event while its durable card-deletion row is pending.

Scheduled events close atomically at their configured end, or at their start
when no end is configured. The same transaction rejects racing late RSVPs and
makes the completed event eligible for ordinary retention cleanup.

## Operations

### Pause and resume

For a suspected unsafe delivery, an administrator runs `/engagement pause`,
then `/engagement status` to confirm the state. Diagnose using safe logs and
aggregate counts only. After correction, run `/engagement resume` and verify
health. Do not manually repost recap, reminder, or result cards. That defeats
the very leases intended to prevent duplicate delivery.

### Backup and restore

Before upgrade, restore, or storage investigation, stop Jarvis cleanly and
back up the SQLite file using [Deployment](DEPLOYMENT.md). For Docker, stop the
single service and back up `jarvis-data`. Never copy only a live SQLite main
file; stop first for consistent WAL state. Protect backups as production
personal data and record only version, timestamp, and approved location.

To restore, stop the one process, preserve the affected database as controlled
incident evidence, put the authorized backup at `DATABASE_PATH` or restore the
volume, verify ownership/free space, then start exactly one process. Verify
`/status`, `/engagement status`, and a non-sensitive feature command. Restore
rolls state back to the backup point. It is not a casual undo button.

### Outage and rollback

Pause engagement if duplicate or unsafe delivery is plausible. For Discord
access/outage, restore only the minimum permission in the configured channel
and let the scheduler recover. For SQLite locks, read-only storage, or failed
health, stop duplicates, verify ownership and disk space, then restore an
approved stopped backup only if needed. Never manually edit rows or delete
records as a repair.

For rollback: pause if needed, stop Jarvis, back up storage, deploy the prior
approved revision, run that revision's `npm run register-commands` if its
definitions differ, start one process, and verify `/status`, `/engagement
status`, and one configured feature. Keep the pre-rollback backup for
authorized recovery.

## Release verification

Before release, run `npm run docs:check`, `npm test`, `npm run build`, and
`git diff --check`. In a non-sensitive development guild, verify administrator
status, preview/cancel, event list, recap preview, trivia opt-out/opt-in, and a
pause/resume cycle. Production members are not a staging environment.

See [Configuration](CONFIGURATION.md), [Discord setup](DISCORD_SETUP.md),
[Operations](OPERATIONS.md), and [Security model](SECURITY_MODEL.md).
