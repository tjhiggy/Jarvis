# Troubleshooting

## Sleeper standings unavailable

`/fantasy standings` requires `SLEEPER_LEAGUE_ID` and a restart after changing
it. Use the league ID from Sleeper, not an invite or draft URL. During
pre-draft, unassigned rosters may appear as `Roster 6` rather than a team name.
Sleeper outages, rate limits, malformed responses, or missing data produce a
safe unavailable response; Jarvis does not invent standings. The integration
is read-only and never changes lineups, waivers, trades, rosters, league
settings, or Discord settings.

Use the safe diagnosis steps below. Do not paste `.env` values, Discord IDs,
prompts, replies, or SQLite contents into tickets. If a step needs a database
copy or configuration change, stop the bot first and follow
[Operations](OPERATIONS.md).

## Bot is offline or exits at startup

**Likely cause.** Required Discord configuration is empty, the selected provider
is misconfigured, the persona, FAQ catalog, or database path is unavailable, or
the compiled entry point is missing.

**Safe diagnosis.** Confirm `npm run build` completed, then use the supported
manual `npm start` path in an owning console so startup failures remain visible.
Check the startup error category and invalid configuration variable names
without revealing values. Do not treat `scripts/start-jarvis.ps1 -DryRun` as
verification; it only prints unverified configuration claims. Its other
workstation-specific limitations are documented in
[Deployment](DEPLOYMENT.md#workstation-specific-convenience-helper).

**Resolution.** Correct the named configuration or path using the approved
secret source, rebuild if needed, and restart one process. OpenAI requires a
non-empty project key; Ollama requires a configured base URL and model.

## Poll configuration or commands are unavailable

**Likely cause.** Both poll credentials are blank, exactly one is configured,
an administrator ID is not a 17-to-20 digit Discord user ID, or the voter
secret is shorter than 32 characters.

**Safe diagnosis.** Read only the startup error's named environment variable
and `/status` readiness. Do not paste administrator IDs, the voter secret, poll
text, or voter data into logs or tickets.

**Resolution.** Leave both credentials blank to disable polls, or configure
both through the approved secret boundary, restart Jarvis, and run
`npm run register-commands` once in the intended development guild.

## FAQ catalog validation fails

**Likely cause.** `FAQ_CATALOG_PATH` is missing, unreadable, malformed, empty,
contains more than 25 entries, or contains an entry that violates the approved
schema.

**Safe diagnosis.** Startup reports only
`Invalid FAQ catalog configuration: FAQ_CATALOG_PATH`; registration reports a
generic failure. Check the configured file against the reviewed deployment
revision without pasting its absolute local path or answer content into logs,
tickets, or chat. Discord input never controls this path.

**Resolution.** Restore the approved checked-in catalog, correct
`FAQ_CATALOG_PATH` through operator-managed configuration if an override is
intentional, and restart. Run `npm run register-commands` once after deployment
so the development guild receives choices from the same validated catalog.

## Commands are missing

**Likely cause.** The bot was installed without `applications.commands`,
registration targeted a different guild, or command definitions changed without
registration.

**Safe diagnosis.** Confirm the configured client and guild identifiers through
approved operator records. Confirm this version defines `/ask`, `/search`,
`/forget`, `/faq`, `/help`, and `/status`, and that its FAQ catalog validates.

**Resolution.** An authorized operator may run `npm run register-commands`
against the intended guild. It bulk-overwrites this application's command set
there, so do not run it as a speculative fix in an unfamiliar server. Global
registration is not the default deployment path.

## Discord permissions or allowlist blocks requests

**Likely cause.** The bot lacks View Channel, Read Message History, Send
Messages, or Send Messages in Threads as appropriate; a channel is outside
`ALLOWED_CHANNEL_IDS`; or the parent-channel mapping is wrong for a thread.

**Safe diagnosis.** Check the bot role and channel overrides, then compare the
current channel or parent channel against the operator-managed allowlist. An
empty allowlist allows every server channel where the bot can operate.

**Resolution.** Have an authorized Discord administrator grant only the required
channel permissions or correct the configured allowlist, then restart Jarvis.
Do not grant Administrator to solve a channel-specific problem. That is using a
flamethrower to light a birthday candle.

## AI is unavailable

**Likely cause.** The selected provider timed out, rejected authentication,
reported quota or rate limits, rejected a request, or returned an unsuccessful
response.

**Safe diagnosis.** Use `/status` to confirm provider configuration, then
inspect safe error categories and provider account health. Do not log the prompt
or response. The generic maintenance message deliberately hides internal detail.

**Resolution.** Correct credentials through the secret manager, confirm the
model is available, resolve quota or billing with the provider owner, or wait
through a rate-limit interval. Do not increase retry counts blindly: both
adapters retry only bounded retryable failures.

## Ollama model is missing or not ready

**Likely cause.** Ollama is not serving, the configured model was not pulled, or
Docker is targeting the wrong host endpoint.

**Safe diagnosis.** For native deployment, verify the configured endpoint and
model against the local Ollama inventory using its supported operator workflow.
For Docker Desktop with host Ollama, verify
`OLLAMA_BASE_URL=http://host.docker.internal:11434`.

**Resolution.** Start Ollama using its supported workflow, pull the configured
model, correct the URL or model value, and restart Jarvis. Do not publish the
Ollama endpoint to the public internet.

## Tavily web search fails

**Likely cause.** `TAVILY_API_KEY` is absent or invalid, the request timed out,
or Tavily returned a non-success status.

**Safe diagnosis.** `/status` shows whether web search is configured. Inspect
only safe operational metadata and provider account status. The cache is
in-process memory and clears on restart.

**Resolution.** Restore an approved key through the secret manager, correct
network access or the configured timeout, and retry with a non-sensitive query.
Without a key, `/search` reports that web search is not configured.

## SQLite reports a lock, read-only path, or unhealthy database

**Likely cause.** Two Jarvis processes are sharing a database, the configured
directory is not writable, a Docker bind mount is owned incorrectly, or a
previous process did not release the file cleanly.

**Safe diagnosis.** Stop duplicate processes first and verify deployment mode.
Use `/status` for the application health check. Confirm directory ownership
and free storage without querying or exporting conversation rows. SQLite has a
five-second busy timeout and WAL mode, not magical powers.

**Resolution.** Run exactly one deployment, restore write access to the database
directory, and restart gracefully. In Compose, retain the named `jarvis-data`
volume at `/app/data`; do not make the whole container writable. Restore a
stopped bot from a known-good backup only when recovery is authorized.

## Poll buttons are expired, unavailable, or do not update

**Likely cause.** The poll closed or expired, Jarvis lost access to its own
message, the message was removed, Discord returned a transient failure, or a
second process is competing for the database.

**Safe diagnosis.** Check `/status`, the deployment mode, and content-free poll
operation logs. Do not query, export, or paste poll text, options, or voter
tokens. A closed poll intentionally disables buttons.

**Resolution.** For a transient synchronization failure, leave one running
process online for the scheduler's bounded retry cycle. If the message is gone
or inaccessible, the poll becomes orphaned and stops retrying; restore minimum
channel access if appropriate, then create a new poll. Do not modify or delete
other Discord messages as a repair tactic.

## Poll SQLite lock or scheduler retries persist

**Likely cause.** Two Jarvis instances share `DATABASE_PATH`, storage is not
writable, or the host is resource constrained.

**Safe diagnosis.** Verify one process, directory access, free storage, and
safe scheduler error categories without opening poll tables or extracting
voter data.

**Resolution.** Gracefully stop duplicate instances, restore local database
access, and restart one process. If a poll was orphaned after bounded retries,
preserve the database for authorized recovery and use a new poll instead of
manual row edits.

## Reminder is missing, delayed, uncertain, or cannot be cancelled

**Likely cause.** The original channel or thread was removed or is no longer
allowlisted, permissions changed, Discord returned a transient failure, the
send outcome was ambiguous, or the reminder is already terminal.

**Safe diagnosis.** Use `/status` for reminder store and scheduler health and
inspect only content-free operation categories. Confirm the original destination
still exists and is allowed. Do not paste reminder text, IDs, user IDs, or raw
Discord errors into tickets. A delivered or failed reminder is intentionally
not cancellable; unknown and non-owned IDs receive the same safe response.

**Resolution.** Restore the minimum destination access if appropriate and leave
one process running through the bounded retry cycle. An uncertain outcome is
not reposted because a duplicate public reminder is worse than a little
ambiguity. For persistent store failure, stop duplicate processes, restore local
database access, then restart gracefully. Do not edit SQLite rows manually.

## Engagement scheduler is paused, unhealthy, or did not post

**Likely cause.** Engagement is paused for the guild, its configured destination
is unavailable, recap is disabled or lacks a valid schedule, Discord delivery
failed, or SQLite cannot acquire the local database.

**Safe diagnosis.** A configured administrator runs `/engagement status` and
checks only the returned aggregate scheduler/database state and content-free
logs. Confirm one process, the feature's exact configured channel, and minimum
channel permissions. Do not paste engagement text, RSVP reasons, member IDs,
or database rows into a ticket.

**Resolution.** Use `/engagement pause` during an unsafe-delivery incident,
restore the minimum channel or SQLite access, then `/engagement resume` and
verify status. Do not manually repost a recap/result or edit SQLite rows. For a
restore or rollback, follow the [Engagement runbook](ENGAGEMENT_RUNBOOK.md).

## Engagement feature or command is unavailable

**Likely cause.** `ENGAGEMENT_ENABLED` is false, the feature's own destination
channel is blank, administrator roles are missing, or definitions were not
registered after deployment.

**Resolution.** Correct only the required configuration, restart the single
process, and run `npm run register-commands` in the intended development guild.
Grant neither privileged intents nor Discord Administrator as a shortcut.

## Responses are long or arrive in several messages

**Likely cause.** The response approaches Discord's message limit. Jarvis caps
model output at 1,000 tokens and safely splits delivery into chunks.

**Safe diagnosis.** Confirm the bot is responding normally and that messages are
delivered sequentially. Review configuration bounds rather than copying response
content into an incident.

**Resolution.** This is expected delivery behavior. If response size is an
operational concern, review the persona and output-cap code through the normal
change process; there is no environment setting for the 1,000-token ceiling.

## Docker or WSL memory pressure

**Likely cause.** Docker Desktop's WSL VM, the container, and local Ollama are
competing for a low-memory Windows host.

**Safe diagnosis.** Identify the active deployment path and observe host-level
resource pressure without collecting Discord content. Confirm that a native
Jarvis process is not also running.

**Resolution.** Prefer native Node and native Ollama on constrained Windows
hosts. If Docker remains necessary, configure conservative WSL limits suitable
for the machine, restart WSL or Docker Desktop after changes, and retest a
non-sensitive request.

## Duplicate processes or duplicate replies

**Likely cause.** Native and Docker deployments are both connected, or more than
one native process was launched.

**Safe diagnosis.** Inspect process and container metadata for the compiled
Jarvis entry point. Do not rely on the workstation-specific helper for this
check: its literal `dist/src/index.js` command-line match is separator-sensitive
and can miss equivalent paths.

**Resolution.** Gracefully stop all but the approved single instance, verify
database health, and test with a non-sensitive prompt. Do not delete the
database to stop duplicate replies. That would be a spectacularly bad trade.
