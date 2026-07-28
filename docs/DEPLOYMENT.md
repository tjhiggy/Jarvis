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

4. Choose and prepare the configured provider. For local Ollama, pull the
   configured model using Ollama's supported workflow. For OpenAI, set the
   project-scoped key and verify the configured model is available to that
   project.
5. Start Jarvis with `npm start`, or use the supplied startup script when a
   scheduled Windows start is required:

   ```powershell
   .\scripts\start-jarvis.ps1
   ```

The startup script is deliberately opinionated. It expects Node at
`C:\Program Files\nodejs\node.exe`, Ollama at the current user's
`%LOCALAPPDATA%\Programs\Ollama\ollama.exe`, and a compiled
`dist\src\index.js` below the repository. Its `-DryRun` switch reports those
assumptions without starting processes:

```powershell
.\scripts\start-jarvis.ps1 -DryRun
```

For a scheduled task, configure the task under the same Windows account that
owns the local Ollama installation and can read the deployment's `.env` and
write its database directory. Point the task action at PowerShell and this
script. Do not configure a second task that launches `npm start`: the script
already detects a matching `node.exe` command line and exits when one exists.

## Ollama readiness

The script checks `http://127.0.0.1:11434/api/tags` before it starts Jarvis. It
waits for readiness, starts `ollama serve` if the endpoint remains unavailable,
then waits again before starting Node. It fails rather than launching Jarvis
against an unavailable local provider. Native script output goes to these
per-user temporary files:

- `%TEMP%\jarvis-native.out.log` and `%TEMP%\jarvis-native.err.log`
- `%TEMP%\jarvis-ollama.out.log` and `%TEMP%\jarvis-ollama.err.log`

Inspect only operational metadata when handling those logs. Do not copy
prompts, responses, identifiers, or credentials into tickets.

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
already failed and an authorized incident lead directs it.
