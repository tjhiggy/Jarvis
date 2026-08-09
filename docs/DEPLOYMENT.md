# Deployment

Jarvis is one Node.js process with a local SQLite database. It receives Discord
Gateway events over an outbound connection and does not expose an inbound web
port. Native Windows is the primary deployment path. Docker is an optional
alternative for hosts that already operate Docker Desktop.

See [Configuration](CONFIGURATION.md) before deployment and
[Discord setup](DISCORD_SETUP.md) before registering commands. Keep real values
only in the ignored `.env` file or an approved secret manager.

## Native Windows deployment

1. Install Node.js 22 or newer, then clone the approved revision on the host.
2. Create `.env` from `.env.example`, set the required Discord values, and use
   an explicit `ALLOWED_CHANNEL_IDS` list for production.
3. Install, build, and register commands in the authorized guild:

   ```powershell
   npm ci
   npm run build
   npm run register-commands
   ```

   Command registration bulk-overwrites this application's command set in the
   configured guild. It is an operator action, not a health check.

   A reminder-capable revision requires registration before `/reminder set`,
   `list`, and `cancel` appear. Back up the stopped SQLite database or
   persistent volume before an upgrade. Registration and live Discord tests are
   operator actions, never deployment side effects.

   Before starting the new process, stamp the deployment identity in the
   ignored `.env` file. `JARVIS_VERSION` should match the release or package
   version, `JARVIS_COMMIT_SHA` should match the reviewed revision, and
   `JARVIS_BUILD_TIMESTAMP` should be an explicit UTC timestamp. Set
   `JARVIS_ENVIRONMENT=production` for a production host. These values are
   trusted operator metadata, not host inspection. Never copy them from a
   Discord message or expose secrets alongside them.

4. Choose and prepare the configured provider. For local Ollama, pull the
   configured model using Ollama's supported workflow. For OpenAI, set the
   project-scoped key and verify the configured model is available to that
   project.
   If `SLEEPER_LEAGUE_ID` is set, `/fantasy standings` is enabled as a
   read-only integration; it requires no additional credential.
5. Start Jarvis manually from the deployment directory in an owning console:

   ```powershell
   npm start
   ```

   Keep that console available and stop the process with `Ctrl+C`. This manual
   native start and stop flow is the supported path.

6. Verify the running identity after startup. Run `/status` and compare the
   reported **Build identity** commit with the reviewed revision (`git rev-parse
   HEAD` in the deployment checkout, or the image tag/label used for Docker).
   If they differ, stop the process, rebuild or recreate it from the reviewed
   revision, and check again. A stale commit value is a deployment warning, not
   evidence that the running code is current. A value of `development` or
   `unknown` is expected only for an intentionally local development run.

### Reminder rollout and rollback

After deployment and registration, check `/status` for healthy reminder store
and scheduler lines. In one allowed non-sensitive channel, set a controlled
`/reminder` for one minute, confirm the ephemeral acknowledgement and one
owner-only delivery in that original channel or thread, then cancel any active
test row. Do not use real reminder text.

If this fails, stop Jarvis, restore the prior approved revision and command
definitions, and register that prior command set. Keep the SQLite database and
reminder tables intact unless an authorized backup restore is required.

### Workstation-specific convenience helper

`scripts/start-jarvis.ps1` is a workstation-specific convenience helper, not a
supported service manager or a production-safe start and stop path. It expects
Node at `C:\Program Files\nodejs\node.exe`, Ollama at the current user's
`%LOCALAPPDATA%\Programs\Ollama\ollama.exe`, and a compiled
`dist\src\index.js` below the repository.

Read and verify the helper before considering it for a particular workstation.
Its current limitations are material:

- `-DryRun` prints the quoted Node argument and both Windows and portable
  duplicate-process patterns, but it does not execute those paths, inspect
  process identity, or test Ollama readiness. Its boolean fields remain
  configuration claims rather than a readiness check.
- It requires the fixed Ollama executable and local tags endpoint even when
  `.env` selects `AI_PROVIDER=openai`.
- It launches a detached Node process without retaining a process identifier or
  providing a status or graceful-stop command.

The helper's `-DryRun` output can be inspected as configuration data, but must
not be treated as verification:

```powershell
.\scripts\start-jarvis.ps1 -DryRun
```

The helper quotes repository paths containing spaces and recognizes the
compiled entry point with either Windows or portable path separators. Its
duplicate guard is still a workstation convenience, not distributed locking,
and it does not stop a process cleanly. Use the manual native flow above unless
an operator has separately reviewed and validated the helper for that
workstation.

When used, the helper redirects output to these per-user temporary files:

- `%TEMP%\jarvis-native.out.log` and `%TEMP%\jarvis-native.err.log`.
- `%TEMP%\jarvis-ollama.out.log` and `%TEMP%\jarvis-ollama.err.log`.

Inspect only operational metadata when handling those logs. Do not copy
prompts, responses, identifiers, or credentials into tickets.

## Provider readiness

Before the supported manual start, prepare the selected provider independently.
For Ollama, start it through Ollama's supported local workflow and verify the
configured model in its local inventory. For OpenAI, verify the project key and
model through the approved account workflow. Jarvis `/status` checks
configuration after start; a non-sensitive `/ask` is the controlled
end-to-end provider check.

## Optional Docker deployment

Docker Compose builds the Node 22 Debian image, runs as the unprivileged
`jarvis` user, supplies `.env` at runtime, and mounts a named `jarvis-data`
volume at `/app/data`. The container root filesystem is read-only; `/tmp` is a
bounded non-executable tmpfs. No ports are published.

```powershell
docker compose up --detach --build
docker compose logs --follow jarvis
```

Compose sets `DATABASE_PATH=/app/data/discord-bot.db`. Preserve the named
volume. `docker compose down` removes the container but keeps that volume;
`docker compose down --volumes` deletes it and is not part of routine
operations. When Docker Desktop uses an Ollama instance on the Windows host,
set `OLLAMA_BASE_URL=http://host.docker.internal:11434`.

## Back up before upgrade

The SQLite database stores bot-owned prompts and successful responses. Back it
up before changing the application, provider, database path, or container
image. Stop the bot first so the backup captures a coherent database state.

- Native: stop the Node process gracefully, then copy the configured database
  file and any SQLite companion files present in its directory to protected
  storage.
- Docker: stop the Jarvis container, then use the organization's approved
  Docker-volume backup procedure for `jarvis-data`.

Restrict backup access as tightly as production access. A backup is not a
souvenir album for Discord history.

## Upgrade and rollback

For an approved upgrade, stop Jarvis gracefully, take the backup, update to the
reviewed revision, run `npm ci`, run the validation gates in
[Development](DEVELOPMENT.md), rebuild, and start one instance. With Docker,
build the new image and recreate the service only after the volume backup.

If the release fails validation or operation, roll back without rewriting
history: stop the bot, retain the failed revision for diagnosis, switch the
working tree to the previously approved Git tag, reinstall dependencies for
that revision, rebuild, and start it. Restore the stopped bot's database only
when the incident requires data recovery and the backup is known good. Record
the rollback and preserve content-free evidence.

## Graceful shutdown

For native runs, send `Ctrl+C` in the owning console or otherwise deliver
`SIGINT` or `SIGTERM`; for Compose, use `docker compose stop jarvis`. The
application then stops accepting new work, clears its retention timer, closes
SQLite, and destroys the Discord client. Compose allows a 30-second stop grace
period. Do not kill the process as the first move unless graceful shutdown has
already failed and an authorized incident lead directs it. The
workstation-specific helper has no graceful-stop control, which is another
reason the owning-console flow is the supported native path.
