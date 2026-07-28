# Troubleshooting

Use the safe diagnosis steps below. Do not paste `.env` values, Discord IDs,
prompts, replies, or SQLite contents into tickets. If a step needs a database
copy or configuration change, stop the bot first and follow
[Operations](OPERATIONS.md).

## Bot is offline or exits at startup

**Likely cause.** Required Discord configuration is empty, the selected provider
is misconfigured, the persona or database path is unavailable, or the native
script cannot find its fixed Node, Ollama, or compiled-entry paths.

**Safe diagnosis.** Run `scripts/start-jarvis.ps1 -DryRun` for native script
assumptions. Check the startup error category and invalid configuration variable
names without revealing values. Confirm `npm run build` completed.

**Resolution.** Correct the named configuration or path using the approved
secret source, rebuild if needed, and restart one process. OpenAI requires a
non-empty project key; Ollama requires a configured base URL and model.

## Commands are missing

**Likely cause.** The bot was installed without `applications.commands`,
registration targeted a different guild, or command definitions changed without
registration.

**Safe diagnosis.** Confirm the configured client and guild identifiers through
approved operator records. Confirm this version defines `/ask`, `/search`,
`/forget`, `/help`, and `/status`.

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

**Safe diagnosis.** For native deployment, use the startup script's readiness
check of `http://127.0.0.1:11434/api/tags` and verify the model against the
local Ollama inventory using its supported operator workflow. For Docker Desktop
with host Ollama, verify `OLLAMA_BASE_URL=http://host.docker.internal:11434`.

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
one native process was launched outside the supplied script.

**Safe diagnosis.** Inspect process and container metadata for the compiled
Jarvis entry point. The native script detects a matching `node.exe` command
line in its own project path, but it cannot prevent every externally launched
copy.

**Resolution.** Gracefully stop all but the approved single instance, verify
database health, and test with a non-sensitive prompt. Do not delete the
database to stop duplicate replies. That would be a spectacularly bad trade.
