# Operations

This guide covers routine operation of the deployed Jarvis process. It does
not authorize Discord administration, repository changes, shell execution, or
inspection of user message content.

## Start and stop checks

Before starting, select exactly one deployment path: native Windows or Docker.
Verify the configured `.env` is available to that process, the configured
database location is writable, and the selected AI provider is configured. For
native startup, use `scripts/start-jarvis.ps1 -DryRun` to verify its fixed
executable and entry-point assumptions.

After start, use `/status` in a server channel. It returns an ephemeral report
of Discord configuration, SQLite health, selected AI provider and its
configuration, and web-search configuration. It does **not** make a model
request or prove that Ollama has a loaded model. A successful `/ask` with a
non-sensitive test prompt is the controlled end-to-end check.

Stop native Jarvis with `Ctrl+C` in the owning console or a normal `SIGINT` or
`SIGTERM`. Stop the container with `docker compose stop jarvis`. Wait for the
process to exit before copying or restoring the database. Do not run native and
containerized Jarvis together: both can receive the same Discord events.

## Logs and incident evidence

The application writes structured Pino logs to its host process output. The
Windows startup script redirects Node and Ollama output to `%TEMP%` log files;
Compose exposes container output through `docker compose logs jarvis`.

Collect only the timestamp, component, error class, error category, safe error
code, version, and deployment mode needed for triage. The logger redacts
credential-shaped fields such as token, API key, and authorization values, and
projects errors without their message, stack, content, or secrets. That is a
control, not a license to paste raw output everywhere. Do not include prompts,
assistant responses, Discord identifiers, `.env` data, or database copies in
an incident report.

## Provider health

`/status` reports configuration, not a live AI inference check. For Ollama,
the native start script tests the local tags endpoint before it launches Node.
The Ollama adapter calls `/api/chat`, applies its configured timeout, and
retries retryable failures up to `OLLAMA_MAX_RETRIES`. OpenAI calls use their
own timeout and bounded retry setting. Authentication, validation, and quota
failures are not retried into submission.

If `TAVILY_API_KEY` is configured, web search uses a request timeout and an
in-memory cache. Equivalent normalized queries are cached for
`WEB_SEARCH_CACHE_TTL_MS`, up to 200 entries. The cache disappears on restart;
it is not a persistent data store.

## Database health, cleanup, and retention

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

## Rate limits and resource pressure

The in-process rate limiter applies `RATE_LIMIT_REQUESTS` per guild and user
within `RATE_LIMIT_WINDOW_MS`. On excess requests, the bot returns a short
retry message. It is not a shared cross-process limiter, so duplicate bot
processes undermine the intent as well as producing duplicate replies.

Keep `MAX_INPUT_CHARS`, `MAX_HISTORY_MESSAGES`, `MAX_STORED_MESSAGES`,
provider timeouts, and retry counts within the capacity and cost limits you
operate. Ollama consumes local CPU/GPU memory and disk; the first request after
a model unload can be slower. On low-memory Windows hosts, native Node plus
native Ollama avoids keeping Docker Desktop's WSL VM resident.

## Outage handling and triage

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
