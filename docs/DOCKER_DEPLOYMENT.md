# Docker deployment

Linux Compose is a first-class Jarvis path. Docker Desktop on Windows remains
supported for local host-Ollama work. Neither path replaces the other, and
neither is an automatic production cutover. Never run native Jarvis and a
container with the same Discord token.

Jarvis is one Node.js process and one SQLite file. The Compose stack keeps
exactly one replica. `container_name: jarvis` is the compose-up guard.
`deploy.replicas: 1` documents the same cap for Swarm-style tooling.
**Never `docker compose up --scale`.** Lease-fencing recovers from a crash or a
stale worker after restart. It is not multi-process safety. Two replicas on
one token or one `jarvis-data` volume produce duplicate Discord work.

## Profiles

### Local / default (host Ollama)

Ollama stays on the host. Compose does not add an Ollama container. The
default file sets `AI_PROVIDER=ollama` and
`OLLAMA_BASE_URL=http://host.docker.internal:11434`, and adds
`extra_hosts: host.docker.internal:host-gateway` so Linux and Docker Desktop
can reach the host listener. Native (non-container) Ollama still uses
`http://127.0.0.1:11434`.

```bash
export JARVIS_VERSION=1.6.0
export JARVIS_COMMIT_SHA="$(git rev-parse HEAD)"
docker compose up --detach --build
docker compose logs --follow jarvis
```

PowerShell / Docker Desktop uses the same Compose files:

```powershell
$env:JARVIS_VERSION = "1.6.0"
$env:JARVIS_COMMIT_SHA = (git rev-parse HEAD)
docker compose up --detach --build
```

### Hosted (OpenAI)

Hosted Linux injects secrets from the process environment or the platform
secret manager. A repo-local `.env` is not required. `docker compose config`
must succeed in a clean checkout. The hosted overlay sets `AI_PROVIDER=openai`,
clears `extra_hosts`, and omits every `OLLAMA_*` variable. Do not add an
Ollama service to the hosted stack.

```bash
export JARVIS_VERSION=1.6.0
export JARVIS_COMMIT_SHA="$(git rev-parse HEAD)"
export DISCORD_TOKEN
export DISCORD_CLIENT_ID
export DISCORD_GUILD_ID
export OPENAI_API_KEY
docker compose -f docker-compose.yml -f docker-compose.hosted.yml up --detach --build
```

Compose interpolates a gitignored `.env` for local convenience and passes only
the listed keys into the container. It does not mount or dump the whole file
through `env_file`.

## Image identity

The Dockerfile pins `node:22-bookworm-slim` by digest. Built images are tagged
`jarvis-discord-bot:${JARVIS_COMMIT_SHA:-local}`. Stamp `JARVIS_VERSION` and
`JARVIS_COMMIT_SHA` at deploy time (export them before `compose up` / `build`).
The image also accepts those values as build args and labels. `/status` reports
only this operator-supplied identity.

## Healthcheck

The container healthcheck runs `scripts/docker-healthcheck.mjs` inside the
network namespace. It executes SQLite `SELECT 1` against `DATABASE_PATH`. When
`ADMIN_CONSOLE_ENABLED=true`, it also GETs the Command Deck loopback
`/api/status` route. It does not publish a port.

## Current guardrails

- Non-root `uid 10001`, read-only root filesystem, `/tmp` tmpfs, `cap_drop:
ALL`, `no-new-privileges`, `init: true`, 30s SIGTERM grace.
- SQLite only on the named `jarvis-data` volume at `/app/data`.
- 768 MB memory, 1.5 CPUs, `pids_limit: 256`.
- `json-file` logs with `max-size: 10m` and `max-file: 5`.
- Zero published ports. Command Deck stays bound to `127.0.0.1`.
- No `.env` copied into image layers.

## register-commands is a host or CI job

The runtime image does not include `tsx` or `scripts/register-commands.ts`.
Register commands from a full Node 22 checkout or CI job, then start the
container:

```bash
npm ci
npm run register-commands
```

```powershell
npm ci
npm run register-commands
```

Registration bulk-overwrites this application's guild command set. It is an
operator action, not a health check.

## Command Deck stays loopback-only

Do not publish `8787`. Remote access, when approved, is a sidecar that shares
the Jarvis network namespace and tunnels out. Example only; not part of the
hosted stack:

```yaml
services:
  command-deck-tunnel:
    network_mode: service:jarvis
    # Tunnel client reaches http://127.0.0.1:8787 inside that netns.
    # Do not add ports: on jarvis or on this sidecar.
```

Keep `ADMIN_CONSOLE_HOST=127.0.0.1`. A private tunnel is not permission to
expose the port on the host or the public internet.

## Volumes and shutdown

`docker compose stop jarvis` is the routine stop. `docker compose down` removes
the container and keeps `jarvis-data`. **`docker compose down --volumes` deletes
the volume and is destructive.** It is not part of routine operations.

Back up before upgrades. See [Volume backup and restore](DOCKER_VOLUME_BACKUP.md).

## Evaluation checklist

1. Stop native Jarvis if it is using the same token.
2. Back up the native SQLite database or the `jarvis-data` volume.
3. Export deploy identity and secrets; build and start exactly one replica.
4. Verify container health, `/status`, a mention, one scheduler smoke test, and
   SQLite persistence across recreation.
5. Observe memory and latency before treating Docker as the primary path.
6. Stop the container and restore the prior deployment if instability appears.

Do not treat a successful image build as production approval. Record the
observation window, backup path, smoke-test evidence, and rollback result in
the release enablement checklist.
