# Operations

## Private Sites Command Deck read API

Keep Jarvis bound to `127.0.0.1`. Remote Sites access must traverse the approved
private tunnel and present the dedicated read token, exact HTTPS origin, fresh
timestamp, and unique request UUID. Verify accepted and denied paths with
`npm run command-deck-api:verify`; its receipt is content-free release evidence.

`401` means a token mismatch, stale clock, or replay. `403` means the origin is
not allowlisted. `429` means wait for the configured window. `503` means Jarvis
could not build a truthful snapshot. Do not weaken the policy to hide an error.
Use the localhost Command Deck while repairing the private path, and rotate the
read token after suspected exposure.

## Engagement controls

Configured engagement administrators may run `/engagement status`, `/engagement pause`, and `/engagement resume`. Status is private and reports only configured features, aggregate record counts, scheduler state, and last-run outcome. `/engagement delete` durably queues bot-owned cards, deletes each card first, and removes the corresponding content row only afterward; administrators may provide a member ID. Its private response separates records removed immediately from card-backed records still queued for bounded retry. Pause suppresses scheduled recap, event-reminder, and trivia-result delivery without deleting records and persists until explicit resume.

This guide covers routine operation of the deployed Jarvis process. It does
not authorize Discord administration, repository changes, shell execution, or
inspection of user message content.

## Shipboard broadcast operations

Use `/notifications status` privately to view your own event-reminder and
birthday preference. `/notifications enable category:<category>` and
`disable` change only that crew member's durable preference. RSS, proactive,
recap, and trivia result cards are public channel broadcasts and correctly
redirect members to an administrator rather than offering a cosmetic no-op.

Open the local Command Deck only from the host. The Shipboard Broadcasts card
shows category state, friendly destination, quiet hours, cadence, next
eligible time, last attempt/success, health, and 7/30-day aggregate outcomes.
To pause or resume, select the category, confirm the operation, enter the
local token, and use the returned short-lived confirmation. A pause takes
effect at the final pre-post policy check; it does not delete policy,
preference, feed baseline, or completed delivery history. Global engagement
pause remains the broader emergency stop for scheduled engagement delivery.

For RSS, use the Command Deck preview before saving a feed. Preview fetches up
to five entries and persists nothing. Saving establishes a baseline, so old
entries are not posted. RSS posts at most five entries in one digest per cycle
and at most twenty completed items per MuthaShip per UTC day. A Discord failure
releases the delivery claim for later retry. Do not manually repost a failed
item: that is how duplicate-notification folklore becomes an incident.

## Start and stop checks

Before starting, select exactly one deployment path: native Windows or Docker.
Verify the configured `.env` is available to that process, the configured
database location is writable, and the selected AI provider is configured. For
every deployment, also verify `FAQ_CATALOG_PATH` resolves to the approved local
catalog. Jarvis reads but never modifies it; do not expose it through a
Discord-writable path. The default Docker image already includes the catalog in
its read-only `/app/config` tree.

For the supported native path, start `npm start` from the deployment directory
in an owning console and keep that console available for `Ctrl+C`.

The `scripts/start-jarvis.ps1` file is only a workstation-specific convenience
helper. Its `-DryRun` output makes unverified claims; it does not validate paths
or readiness. The helper also has an unquoted spaced-path risk,
separator-sensitive duplicate detection, an unconditional dependency on a
fixed local Ollama installation even for OpenAI configuration, and no
graceful-stop control. Do not treat it as production-safe process management.
See [Deployment](DEPLOYMENT.md#workstation-specific-convenience-helper) for the
full limitations.

After start, use `/status` in a server channel. It returns an ephemeral report
of Discord configuration, SQLite health, selected AI provider and its
configuration, web-search configuration, FAQ readiness, and whether optional
polls are configured.
It does **not** make a model request or prove that Ollama has a loaded model. A
successful `/ask` with a non-sensitive test prompt is the controlled
end-to-end provider check.

### Truthful runtime identity

Jarvis reports only build metadata explicitly supplied by deployment
configuration: `JARVIS_VERSION`, `JARVIS_COMMIT_SHA`,
`JARVIS_BUILD_TIMESTAMP`, and `JARVIS_ENVIRONMENT`. `/status` labels this as
**Build identity**. It is metadata, not live host inspection. Jarvis does not
inspect or claim the host operating system, hardware, uptime, processes, or
physical ship systems. Missing metadata is shown as safe defaults such as
`development` or `unknown`; Jarvis will not guess.

## FAQ registration and live checks

The `/faq` choices are part of the development-guild command definition. After
deploying a release that changes the catalog or command set, an authorized
operator must run:

```powershell
npm run register-commands
```

Run it once against the intended `DISCORD_GUILD_ID`. Registration
bulk-overwrites this application's command set in that guild and validates the
catalog first, so it is a deployment action, not a health probe.

After registration and startup, manually verify `/faq`, one selected approved
answer, the omitted-topic question listing, a request from a disallowed
channel, and `/status`. If polls are enabled, verify a configured administrator
can create one short two-option poll, a non-administrator cannot create one,
members can change a selection, and `/poll-close` disables the buttons while
keeping final totals. Confirm replies are public where expected, and no
uncontrolled mention fires. These checks do not authorize broader Discord
permissions.

Stop native Jarvis with `Ctrl+C` in the owning console or a normal `SIGINT` or
`SIGTERM`. Stop the container with `docker compose stop jarvis`. Wait for the
process to exit before copying or restoring the database. Do not run native and
containerized Jarvis together: both can receive the same Discord events.

## Weekly recap operations

Weekly recaps require a configured `ENGAGEMENT_RECAP_CHANNEL_ID`, valid weekly
schedule/timezone, and an explicit administrator `/recap enable` opt-in for
each guild. Administrators can run `/recap preview` for a private, non-posting
check, then `/recap pause` or `/recap resume` to control scheduled delivery.
With only a configured recap channel, `/recap preview` is available but no
weekly run can be enabled. `/recap enable` and `/recap resume` require a valid
weekly schedule and IANA timezone. The scheduler leases a per-guild, per-week
run and marks it complete only after Discord accepts the post. Source or
gateway failure releases the lease for a later retry; a completed run is never
posted again. If configured engagement storage is unavailable, it abstains
rather than publishing a partial recap.

## Logs and incident evidence

The application writes structured Pino logs to its host process output. The
supported manual native path leaves that output in its owning console. If the
workstation-specific convenience helper is used, it redirects Node and Ollama
output to `%TEMP%` log files. Compose exposes container output through
`docker compose logs jarvis`.

Collect only the timestamp, component, error class, error category, safe error
code, version, and deployment mode needed for triage. The logger recursively
redacts values under keys named `token`, `apiKey`, or `authorization`
(case-insensitive), including those keys in nested headers, and projects errors
without their message, stack, content, or secrets. It is not a general secret
detector, so differently named fields remain the caller's responsibility. That
is a control, not a license to paste raw output everywhere. Do not include
prompts, assistant responses, Discord identifiers, `.env` data, or database
copies in an incident report.

## Provider health

`/status` reports configuration, not a live AI inference check. For Ollama,
verify its configured model through Ollama's supported local workflow before
starting Jarvis. The Ollama adapter calls `/api/chat`, applies its configured
timeout, and retries retryable failures up to `OLLAMA_MAX_RETRIES`. OpenAI calls
use their own timeout and bounded retry setting. Authentication, validation, and
quota failures are not retried into submission.

If `TAVILY_API_KEY` is configured, web search uses a request timeout and an
in-memory cache. Equivalent normalized queries are cached for
`WEB_SEARCH_CACHE_TTL_MS`, up to 200 entries. The cache disappears on restart;
it is not a persistent data store.

## Database health, cleanup, and retention

Broadcast policy, member preference, and delivery state share
`DATABASE_PATH` with the existing local stores. Back up a stopped database,
including its WAL state, before upgrades. Generic broadcast cleanup removes
only terminal completed delivery rows before its cutoff; it never removes
policies or preferences. A clean shutdown stops new work and all schedulers,
drains active work, then closes stores. Do not copy, edit, or delete a live
SQLite main file as a repair strategy.

`/status` uses SQLite's health check (`SELECT 1`). The store configures WAL
mode, foreign-key enforcement, a five-second busy timeout, and normal
synchronous mode. Jarvis stores its own conversation rows only, isolated by
guild and channel or thread.

At startup and approximately every 24 hours, the process deletes rows older
than `HISTORY_RETENTION_DAYS`. Each append also enforces the global
`MAX_STORED_MESSAGES` cap by evicting oldest rows. `/forget` removes Jarvis
history only for the current guild channel or thread. These are the
application's intentional data deletions; do not run manual database cleanup
as routine maintenance.

## Trivia operations

Trivia is available only in `ENGAGEMENT_ACTIVITY_CHANNEL_ID`. `/trivia start`
posts a bot-owned one-minute question from the checked-in curated catalog.
Buttons are valid only on that bot-owned card in its configured guild and
channel. A restart expires overdue persisted rounds before new work begins.
The ordinary engagement cleanup removes round results and participant IDs after
`ENGAGEMENT_RETENTION_DAYS`; owner-data deletion and guild opt-out also remove
future participation. Do not use this feature for XP, leaderboards, or member
profiling. That would turn a friendly quiz into surveillance with confetti.

The process also checks round expiry every 15 seconds and expires stale rounds
before accepting a new `/trivia start`. SQLite has a partial unique index for
open guild/channel rounds, so two concurrent starts cannot produce overlapping
rounds. Members may use `/trivia opt-out` from any server channel to delete
their retained trivia participant record and block future collection, then
`/trivia opt-in` to rejoin future rounds.

Each expired round is atomically claimed with a persisted delivery lease, then
Jarvis posts one concise aggregate results card with mentions disabled. A
successful post is persisted as complete; an interrupted or failed lease is
released or recovered after one minute. The scheduler logs only its operation
name on failures and continues at the next bounded tick. Opt-out marker writes
and participant-record deletion are one SQLite transaction, so a deletion
failure rolls back the marker instead of leaving a half-finished preference.
Within one running process, expiry ticks are single-flight: a slow Discord post
cannot be reclaimed by a later interval tick. Persisted stale-lease recovery
remains the path for a genuinely abandoned job after a restart.

## Poll lifecycle, recovery, and rollback

When polls are enabled, their tables share `DATABASE_PATH` but are separate
from conversation rows. Poll state, messages, deadlines, and aggregate totals
survive a restart. After Discord login, the scheduler runs every
`POLL_EXPIRY_CHECK_SECONDS`, with one tick at a time: it closes overdue polls,
retries pending Jarvis-owned message edits, and removes terminal poll records
older than `POLL_RETENTION_DAYS`. It contains a bounded batch, so a bad poll
does not turn maintenance into an infinite shift.

If Jarvis cannot fetch or edit its poll message because it was removed or access
was lost, it marks the poll orphaned and stops retrying after its bounded retry
schedule. Restore the minimum channel access and create a new poll if needed;
do not edit or delete other Discord messages to repair it. To roll back a poll
release, stop Jarvis, deploy the prior approved application version, register
that version's command set once if necessary, then start one process. Back up
the database first and do not roll back by deleting SQLite files.

## Backup and restore

Back up before upgrades and before any storage investigation that could change
the deployment. Stop the bot, copy the database using the procedure in
[Deployment](DEPLOYMENT.md), and protect the backup like production data.

To restore, stop Jarvis, retain the affected database as incident evidence
under approved controls, put the approved backup at the configured
`DATABASE_PATH` (or restore the Docker volume), confirm ownership and access,
then start one process and run `/status`. A restore rolls conversation history
back to the backup point. Treat it as an authorized recovery decision, not a
casual undo button.

## Schema rollback classification

Jarvis refuses to open a SQLite database whose `user_version` is newer than the
binary supports. That refusal is intentional and classified as follows:

- **Supported**: database schema version is less than or equal to the running
  application. Open proceeds normally after migrations (if any) complete.
- **Unsupported**: database schema version is greater than the running
  application. The process must not open the file. The only approved recovery
  is to restore a pre-upgrade backup that was taken with a matching application
  version, then start that matching binary.

Do not attempt to lower `user_version` by hand, edit migration tables, or run
an older binary against a newer database. Those paths are unsupported and can
corrupt durable state. Always take a stopped-database backup before an upgrade
that changes schema, and keep that backup until the new version has been
verified in production.

The executable proof for this classification lives in
`tests/storage-recovery.test.ts` (shared-database recovery rehearsal).

## Rate limits and resource pressure

The in-process rate limiter applies `RATE_LIMIT_REQUESTS` per guild and user
within `RATE_LIMIT_WINDOW_MS`. On excess requests, the bot returns a short
retry message. It is not a shared cross-process limiter, so duplicate bot
processes undermine the intent as well as producing duplicate replies.

Polls have the same single-process assumption. The active-poll limit, creator
creation-rate limit, scheduler, and SQLite coordination are local-process
controls. Run one Jarvis process against one database. Horizontal scaling needs
a redesigned shared coordination and storage model; it is not a harmless
checkbox.

Keep `MAX_INPUT_CHARS`, `MAX_HISTORY_MESSAGES`, `MAX_STORED_MESSAGES`,
provider timeouts, and retry counts within the capacity and cost limits you
operate. Ollama consumes local CPU/GPU memory and disk; the first request after
a model unload can be slower. On low-memory Windows hosts, native Node plus
native Ollama avoids keeping Docker Desktop's WSL VM resident.

## Outage handling and triage

### Sleeper standings

Set `SLEEPER_LEAGUE_ID` to the 8-to-20 digit league ID and restart Jarvis. No
Sleeper API key is required. Verify with `/fantasy standings`. A pre-draft
league can legitimately show unassigned roster slots and zero scores. Sleeper
outages, rate limits, and invalid responses produce a safe unavailable message;
Jarvis does not guess or perform any Sleeper write operation.

Provider and storage failures return a generic maintenance-themed retry message
to users. It intentionally avoids exposing credentials, provider details, or
internal errors. Treat the message as a service symptom, not a diagnosis.

1. Establish scope with deployment mode, start time, `/status`, and safe log
   metadata. Do not capture message bodies.
2. Check whether a second native or container process is connected.
3. Check provider configuration and local Ollama readiness, or OpenAI project
   authentication, model availability, billing, and rate limits as applicable.
4. Check database health and writable storage without opening or exporting
   conversation content.
5. Make the smallest authorized corrective action, verify with `/status` and a
   non-sensitive test prompt, and document the outcome without Discord content.

See [Troubleshooting](TROUBLESHOOTING.md) for symptom-by-symptom recovery.

## Concise-response rollback

If concise routing produces a regression, deploy the previously approved
application version and restart the single Jarvis process. No command
registration, database migration, or data deletion is required. Verify one
casual prompt, one current factual prompt, and an explicit `/search` request
after rollback. Do not attempt to repair output by deleting conversation data.

## FAQ rollback

If the FAQ release fails validation or live checks, stop Jarvis, deploy the
previously approved application version, and run that version's
`npm run register-commands` once to restore its prior command set. Then start
one process and repeat the controlled checks. The catalog has no database
migration, so do not restore or delete SQLite merely to roll back `/faq`.

## Personal reminder operations

Back up the stopped SQLite database or persistent volume before a reminder
upgrade. After deployment, run command registration, inspect `/status` for
reminder store and scheduler health, and perform one controlled one-minute test
in an allowed non-sensitive channel. Confirm one ephemeral acknowledgement and
one owner-only delivery in the original channel or thread. The scheduler uses
leases, bounded batches, retries near 1, 5, and 15 minutes, and seven-day
terminal retention; logs must contain only counts and failure categories.

For a bad rollout, stop the process, restore the prior approved revision and
command set, re-register, then restart one process. Do not delete reminder
tables as rollback. `/forget` only clears conversation history and cannot be
used as account-wide reminder deletion.

## Engagement operations

Configured administrators use `/engagement status` for aggregate feature,
database, record-count, pause, and scheduler health. It excludes contribution
text, RSVP reasons, and credentials. `/engagement pause` stops scheduled recap,
event-reminder, and trivia-result delivery for that guild; `/engagement resume`
re-enables delivery after correction. Member deletion remains available while
paused.

Before an engagement upgrade, restore, or storage investigation, back up the
stopped SQLite database or Docker volume. For Discord failure, restore only the
minimum destination permission and allow scheduled recovery. For SQLite failure,
stop duplicate processes, restore approved local storage if necessary, and
restart exactly one process. Never edit engagement rows or manually repost
scheduled output. See the [Engagement runbook](ENGAGEMENT_RUNBOOK.md) for
pause, backup, restore, outage, retention, and rollback procedures.
