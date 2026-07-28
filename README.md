# Jarvis Discord Bot

Jarvis is The Muthaship's answer-only advisory AI: useful first, shipboard wit
second, imaginary moderator powers never. It responds to `/ask` and direct
mentions, keeps short conversation history per Discord channel or thread, and
uses the OpenAI Responses API.

## 1. Architecture

Jarvis is a layered modular monolith running as one Node.js 22 process:

1. `discord.js` receives guild messages and application-command interactions
   over Discord's outbound Gateway connection.
2. Discord adapters normalize mentions and `/ask` requests.
3. The conversation service enforces channel access, input limits, per-user
   rate limits, duplicate suppression, persona mode, and isolated history.
4. The OpenAI adapter calls the Responses API with bounded retries, a timeout,
   and a 1,000-token output ceiling.
5. SQLite stores bot-owned conversation records by guild and channel or thread.
6. Safe delivery neutralizes Discord mentions and splits long responses.

There is no web server and no inbound port to expose. The default deployment is
one process with one SQLite database. Store and extension interfaces leave room
for PostgreSQL, workers, and read-only integrations later without pretending
those features already exist.

## 2. Prerequisites

- Node.js 22 or newer and npm.
- A Discord account that can create an application and install it in the target
  server. Installing normally requires **Manage Server** in that server.
- An OpenAI API project with billing configured and a project-scoped API key.
- Docker Engine with Docker Compose v2 if using the container deployment.
- A server you are authorized to configure. Production is a lousy place to
  discover that "I thought I had permission" is not a permission model.

Clone the repository, then create the local environment file:

```powershell
Copy-Item .env.example .env
```

The committed `.env.example` contains blank placeholders and safe defaults.
Put real credentials only in the ignored `.env` file or a production secret
manager.

## 3. Create the Discord application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications)
   and select **New Application**.
2. Give it a name such as `Jarvis`, accept Discord's terms, and create it.
3. On **General Information**, record the **Application ID**. This is
   `DISCORD_CLIENT_ID`.
4. Configure the installation for a server, not a user-only installation.

The application is the container for the bot identity, credentials, OAuth
settings, and commands. Creating it does not install anything into a server.

## 4. Create and configure the bot user

Open the application's **Bot** page and create or add the bot user if Discord
has not already provisioned it.

Do not enable any privileged intents. The code requests only the nonprivileged
Guilds and Guild Messages intents. Discord includes message content when a
message directly mentions the application, which is the only message path
Jarvis handles. It does not need Message Content, Presence, or Server Members.

Choose whether the bot may be installed publicly based on your operation. A
private bot is the safer default for a single-server deployment.

## 5. Grant minimum Discord permissions

In the Developer Portal's installation defaults or OAuth2 URL Generator, select
the `bot` and `applications.commands` scopes. Calculate the bot permission
integer there from the minimum permissions needed in Jarvis channels:

- **View Channels**
- **Send Messages**
- **Read Message History**
- **Embed Links**, optional if you want rich link previews
- **Send Messages in Threads**, only when Jarvis will operate in threads

Members also need **Use Application Commands** where they will invoke slash
commands. Channel and role overrides can narrow access further.

Do not grant **Administrator**, Manage Channels, Manage Roles, Manage Messages,
moderation permissions, or webhook permissions. Administrator is not a
shortcut. It is a surrender note disguised as a checkbox.

After the portal calculates the minimum permission integer, substitute only the
two placeholders in this invitation template:

```text
https://discord.com/oauth2/authorize?client_id=YOUR_DISCORD_CLIENT_ID&scope=bot%20applications.commands&permissions=REPLACE_WITH_CALCULATED_MINIMUM_PERMISSION_INTEGER
```

Open the completed URL, select the server, review the requested permissions,
and authorize the installation. Never paste a fabricated client ID or a broad
precomputed administrator value into documentation.

## 6. Set the Discord token

On the Developer Portal's **Bot** page, reset or reveal the bot token and put it
in `.env`:

```dotenv
DISCORD_TOKEN=your_bot_token
```

The bot token is a password. It is not the Application ID, public key, OAuth
client secret, or OpenAI key. Never commit it, paste it into chat, bake it into
an image, or place it in this README. If it is exposed, reset it immediately in
the portal and replace the deployed value.

## 7. Set client, guild, and channel IDs

Set the application and target server identifiers:

```dotenv
DISCORD_CLIENT_ID=your_application_id
DISCORD_GUILD_ID=your_server_id
```

The client ID is the **Application ID** on the application's General
Information page. To copy server and channel IDs, enable **Developer Mode** in
Discord under User Settings, Advanced. Then right-click the server or channel
and choose **Copy ID**.

Map channels with comma-separated IDs:

```dotenv
ALLOWED_CHANNEL_IDS=YOUR_IMMERSIVE_CHANNEL_ID,YOUR_TECHNICAL_CHANNEL_ID
RESTRAINED_CHANNEL_IDS=YOUR_TECHNICAL_CHANNEL_ID
```

`ALLOWED_CHANNEL_IDS` is the access boundary. An empty value allows every
server channel where the bot role has the required permissions, so an explicit
production allowlist is strongly recommended. A listed parent channel also
allows its threads.

`RESTRAINED_CHANNEL_IDS` changes tone, not access. Jarvis is immersive by
default:

> Crew brief: the cache is stale. Purge it, restart the worker, and the ship
> should stop screaming into the void.

In restrained technical channels it favors direct delivery:

> Diagnosis: the cache is stale. Clear it, restart the worker, and verify the
> next request.

Threads inherit the restrained mode of a listed parent channel.

## 8. Choose the AI provider

Jarvis supports local Ollama and the OpenAI Responses API. Ollama is the
default in `.env.example`, requires no API credits, and keeps prompts on the
machine running the model.

Install Ollama, pull a model, and configure local development:

```powershell
ollama pull gemma3:4b
```

```dotenv
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma3:4b
OLLAMA_TIMEOUT_MS=120000
OLLAMA_MAX_RETRIES=1
```

When Jarvis runs in Docker Desktop and Ollama runs on the Windows host, use:

```dotenv
OLLAMA_BASE_URL=http://host.docker.internal:11434
```

Do not expose Ollama's port to the public internet. Local inference has no
per-message API bill, but it uses local memory, disk, GPU/CPU time, and
electricity. The first answer after a model has unloaded can be slower.

### Optional live web search

Add a Tavily API key to let Jarvis answer questions that require current
information:

```dotenv
TAVILY_API_KEY=tvly-your-key
WEB_SEARCH_TIMEOUT_MS=10000
WEB_SEARCH_CACHE_TTL_MS=3600000
WEB_SEARCH_MAX_RESULTS=5
```

Jarvis automatically searches for clearly time-sensitive requests containing
terms such as `latest`, `today`, `current`, `news`, `update`, or `patch`.
Members can force a current search with:

```text
/search query:latest ARC Raiders update
```

Searches use Tavily's one-credit basic mode, request at most five summarized
results, never request raw page content, and cache equivalent queries for one
hour by default. Jarvis appends source links to grounded answers. Search-result
text is treated as untrusted evidence and cannot authorize actions or override
Jarvis's safety instructions.

To use OpenAI instead:

Create a dedicated project and project-scoped secret in the
[OpenAI API platform](https://platform.openai.com/), then set:

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=your_project_api_key
OPENAI_MODEL=gpt-5.6-luna
```

Use a distinct key per environment. Keep it server-side, restrict its project
permissions and model access where practical, and rotate it after any suspected
exposure. The OpenAI API is billed separately from ChatGPT subscriptions.

`OPENAI_MODEL` is operator-controlled. Confirm that the configured model exists
for the project before startup. Model names, availability, and pricing change,
because apparently even constants now have a release cadence.

## 9. Register guild commands

Install dependencies and register the four guild-scoped commands:

```powershell
npm ci
npm run register-commands
```

This creates or updates `/ask`, `/forget`, `/help`, and `/status` only in
`DISCORD_GUILD_ID`. Guild registration is deliberate because it updates quickly
and keeps development isolated. Run the command again after changing command
definitions. Discord's guild route is a bulk overwrite: command types omitted
from the submitted four-command set are removed from this application's guild
command set. It does not affect commands owned by other applications.

Global registration is a later, explicit deployment choice. To enable it,
review the code and deliberately change the route in
`scripts/register-commands.ts` from:

```ts
Routes.applicationGuildCommands(config.clientId, config.guildId);
```

to:

```ts
Routes.applicationCommands(config.clientId);
```

Then test and register once. Global commands reach every server that installed
the application and may propagate more slowly than guild commands. Do not
silently register both scopes or automate the change without operator approval.

## 10. Run locally

For development with automatic reload:

```powershell
npm ci
npm run register-commands
npm run dev
```

For a compiled local production run:

```powershell
npm ci
npm run build
npm start
```

Mention the bot with a nonempty prompt or use `/ask`. `/help` lists commands,
`/status` checks Discord, database, and the selected AI provider configuration
without making a model request, and `/forget` deletes bot-owned history only
for the current guild channel or thread.

Stop with `Ctrl+C` so Jarvis can stop accepting work, close SQLite, and
disconnect cleanly.

### Low-memory Windows hosts

On a 16 GB Windows machine, run Jarvis directly with `npm start` instead of
keeping Docker Desktop's WSL VM resident. Ollama and the native Node.js process
can communicate through `http://127.0.0.1:11434` without Docker's additional
memory overhead.

If Docker is still used occasionally, a conservative `%USERPROFILE%\.wslconfig`
can keep WSL from swallowing the workstation:

```ini
[wsl2]
memory=3GB
processors=4
swap=1GB
vmIdleTimeout=60000

[experimental]
autoMemoryReclaim=gradual
sparseVhd=true
```

Restart WSL or Docker Desktop after changing that file. Do not run both the
Dockerized and native Jarvis processes at once, unless duplicate Discord
responses sound like a feature to you.

## 11. Run with Docker

Register commands from the host once, then build and start:

```powershell
npm ci
npm run register-commands
docker compose up --detach --build
docker compose logs --follow jarvis
```

The multi-stage image builds native SQLite dependencies and runs them on the
same Node 22 Debian libc. The final process is UID/GID `10001` (`jarvis`), has
all Linux capabilities dropped, and receives no inbound ports.

Compose mounts the `jarvis-data` named volume at `/app/data`, the only persistent
writable path. The root filesystem is read-only and `/tmp` is a small,
non-executable tmpfs. `docker compose down` removes the container but preserves
history. `docker compose down --volumes` permanently deletes the named volume,
so do not add `--volumes` merely because a tutorial was feeling adventurous.

Update with:

```powershell
git pull
docker compose build --pull
docker compose up --detach
```

Back up the named volume using an operator-approved Docker volume procedure
before risky upgrades.

## 12. Security and data retention

Jarvis has an explicit **no-server-mutation guarantee** in this release. It has
no code or requested permission to edit or delete pre-existing Discord content
owned by others, change channels, roles, permissions, members, server settings,
or webhooks. It cannot write GitHub repositories, execute shell commands,
access arbitrary files, or invoke external tools. The persona is advisory and
cannot grant itself authority.

That guarantee covers runtime mutation of server state and third-party
resources. Jarvis still edits its own deferred interaction reply as ordinary
response delivery. The operator-run registration script also bulk-overwrites
this application's command definitions in the configured guild, as documented
above. Neither behavior grants general server administration.

The only destructive operations are:

- `/forget`, which deletes this bot's SQLite history for the current guild
  channel or thread.
- Retention cleanup, which removes bot-owned records older than
  `HISTORY_RETENTION_DAYS` at startup and approximately daily.

History includes prompts and successful assistant responses. It is isolated by
guild and conversation, stored in the local SQLite volume, and is not encrypted
by the application. Protect the host, volume, and backups accordingly.
`MAX_HISTORY_MESSAGES` limits context sent to OpenAI but does not itself delete
newer database rows. `MAX_STORED_MESSAGES` caps total retained rows and evicts
the oldest records after each append so rate-compliant traffic cannot grow the
database without an application bound.

Additional controls include input bounds, explicit channel allowlisting,
per-guild/user rate limits, duplicate-event suppression, parameterized SQL,
neutralized Discord mentions, secret-free structured logs, and trusted persona
instructions separated from untrusted user content.

The repository ignores `.env`, database files, logs, build output, and local
data. Compose passes `.env` at runtime rather than baking it into the image.
Docker administrators can inspect container environment variables, so use your
platform's secret manager for a serious production deployment.

## 13. Troubleshooting

**Commands are missing.** Confirm the app was installed with
`applications.commands`, verify `DISCORD_CLIENT_ID` and `DISCORD_GUILD_ID`, and
rerun `npm run register-commands`. Guild commands update quickly. If you chose
global registration, wait for propagation and make sure a stale guild-scoped
copy is not masking your result.

**The bot is offline or exits immediately.** Run `npm run build`, then inspect
the terminal or `docker compose logs jarvis`. Verify all four required
environment values are nonempty. Reset a rejected Discord token rather than
reusing it harder.

**Mentions are ignored.** Confirm the message directly mentions the bot; do not
enable the privileged Message Content intent. Check the channel ID allowlist and
the bot's View Channel, Read Message History, and Send Messages permissions. For
threads, check Send Messages in Threads and the parent channel mapping.

**Slash commands respond "not available."** `/ask` and `/forget` enforce
`ALLOWED_CHANNEL_IDS`; `/help` and `/status` are safe but server-only
diagnostics. Check the current channel ID or its parent ID when the current
channel is actually a thread.

**OpenAI requests fail.** Use `/status`, inspect content-free logs, and verify
the project key, billing/quota, model access, rate limits, and configured model
name. Authentication and quota errors are not fixed by retries.

**SQLite reports read-only or permission errors.** In Docker, keep
`DATABASE_PATH=/app/data/discord-bot.db` and use the named volume. For a bind
mount, grant UID/GID `10001` write access to that directory. Do not make the
whole container writable to rescue one misowned folder.

**Compose says `.env` is missing.** Copy `.env.example` to `.env`, fill the four
required values, and rerun the command. The file is intentionally not committed.

**Native dependency installation fails locally.** Confirm Node.js 22, remove no
lockfile, and run `npm ci` on the target platform. Docker includes a Debian
build toolchain so `better-sqlite3` can compile if a prebuilt binary is
unavailable.

## 14. Cost controls

- Create a dedicated OpenAI project and key for Jarvis. Configure project
  budgets, multiple alert thresholds, allowed models, and model rate limits.
  OpenAI project budgets are monitoring alerts, not guaranteed hard spending
  caps.
- Monitor the OpenAI usage dashboard and investigate unexpected changes.
- Choose `OPENAI_MODEL` against current quality, latency, and
  [API pricing](https://openai.com/api/pricing/) rather than copying an old cost
  estimate.
- Keep `ALLOWED_CHANNEL_IDS` narrow and Discord permissions narrower.
- Tune `RATE_LIMIT_REQUESTS`, `RATE_LIMIT_WINDOW_MS`, `MAX_INPUT_CHARS`, and
  `MAX_HISTORY_MESSAGES`. Set `MAX_STORED_MESSAGES` for the volume available to
  SQLite. Smaller inputs and histories generally reduce token use.
- The code caps model output at 1,000 tokens per request. Changing that cap
  requires a reviewed code change in `src/index.ts`.
- Keep bounded timeouts and retries. Do not turn transient failure handling into
  an unmetered slot machine. `OPENAI_MAX_RETRIES` accepts 0 through 10; larger
  values are rejected at startup.
- Use `/status` for health checks because it does not call the model.

## 15. Extension points

`src/extensions/contracts.ts` defines disabled-by-default contracts for
read-only GitHub queries, MCP context, repository context, pull-request
summaries, scheduled recaps, gaming scores, image descriptions, and future
administrator authorization. These are interfaces, not working integrations,
credentials, schedules, or tools.

The recommended first extension is a read-only GitHub provider with an explicit
repository allowlist and a token that has no write scopes. Any extension should
start with operator approval, least-privilege credentials, strict input/output
boundaries, tests, content-free logs, and explicit cost limits. Keep retrieved
content untrusted and separate from Jarvis's system instructions.

Customize the checked-in `config/jarvis-persona.md` for operator-approved lore
and voice. Keep it under the validated length limit, never put secrets in it,
and remember that a stylish prompt is not an access-control system.

The no-server-mutation guarantee remains in force until reviewed code and
permissions deliberately change it. Adding an interface does not grant a power.
