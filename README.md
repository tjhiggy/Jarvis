# Jarvis Discord Bot

Jarvis is The Muthaship's answer-only advisory AI: useful first, shipboard wit
second, imaginary moderator powers never. It answers questions in Discord,
keeps bounded conversation history per channel or thread, and can use local or
hosted AI without pretending an interface is a superpower.

Current release: `0.1.0` | Runtime: Node.js 22+ | License: proprietary, except
the Code of Conduct under CC BY 4.0

## What ships

| Verified capability                                                        | Current boundary                                                                                |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `/ask`, `/search`, `/forget`, `/help`, and `/status`, plus direct mentions | Server channels only; `/ask`, `/search`, and `/forget` enforce the configured channel allowlist |
| Short conversation context stored in SQLite                                | Isolated by guild and channel or thread; not encrypted by the application                       |
| Local Ollama and OpenAI Responses providers                                | Exactly one provider is selected at startup                                                     |
| Optional Tavily grounding for current information                          | Disabled without `TAVILY_API_KEY`; search results are untrusted evidence                        |
| Bounded input, output, retries, rate limits, retention, and stored rows    | Single-process controls, not distributed coordination                                           |
| Local responses for clearly unsupported action requests                    | A UX guardrail only; it neither authorizes actions nor replaces permission checks               |
| Native Node.js and hardened Docker Compose deployment paths                | One active Jarvis process and one SQLite database are the supported topology                    |

Jarvis does not moderate Discord, change roles or channels, edit content owned
by others, execute shell commands, access arbitrary files, write to GitHub, or
grant itself tools. The contracts in `src/extensions/contracts.ts` are inert
design seams. Calling them "integrations" would be marketing with a fake
mustache.

See [Architecture](docs/ARCHITECTURE.md) for the source-backed component and
trust-boundary detail, and [Roadmap](docs/ROADMAP.md) for the sharp line between
shipped and proposed work.

## Architecture at a glance

Jarvis is a layered modular monolith with no HTTP server or inbound listening
port:

1. `discord.js` receives outbound Discord Gateway events and interactions.
2. Discord adapters derive request context and enforce server, channel, thread,
   and reply-safety rules.
3. The conversation service owns shared prompt normalization, input limits,
   de-duplication, per-user rate limits, persona mode, history isolation,
   unsupported-action UX responses, and coordinated storage changes.
4. Optional Tavily search grounds current-information requests.
5. The selected Ollama or OpenAI adapter produces a bounded answer.
6. SQLite stores bot-owned conversation records, and safe delivery neutralizes
   mentions and splits long replies.

The copied `.env.example` is Ollama-first. Ollama runs locally and needs no API
credits. OpenAI is an optional hosted provider, and Tavily is an optional web
grounding service. Provider choice changes where prompts are processed, not
what authority Jarvis has.

## First local run

### Prerequisites

- Node.js 22 or newer and npm.
- Ollama installed locally for the default provider.
- A Discord application installed in a server you are authorized to configure.
- The nonprivileged `Guilds` and `GuildMessages` intents, plus only View
  Channel, Read Message History, Send Messages, and Send Messages in Threads
  where needed.

Create the application, bot identity, least-privilege installation, and
development guild using [Discord setup](docs/DISCORD_SETUP.md). Do not grant
Administrator. It is not a shortcut; it is a security incident wearing a
checkbox.

Pull the default local model:

```powershell
ollama pull gemma3:4b
```

Then use this four-command local quick start:

1. Install exactly the locked dependencies.

   ```powershell
   npm ci
   ```

2. Create the ignored local environment file.

   ```powershell
   Copy-Item .env.example .env
   ```

   Before continuing, set `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and
   `DISCORD_GUILD_ID` in `.env`. Keep real values out of commits, tickets,
   screenshots, and chat. The default `AI_PROVIDER=ollama` does not require an
   OpenAI key.

3. Register the five guild-scoped commands in the configured development
   server.

   ```powershell
   npm run register-commands
   ```

4. Start the development watcher.

   ```powershell
   npm run dev
   ```

Mention the bot with a nonempty prompt or use `/ask`. Stop with `Ctrl+C` so the
process closes SQLite and disconnects cleanly. For the compiled path, run
`npm run build` followed by `npm start`.

Every setting, default, and validation rule is in
[Configuration](docs/CONFIGURATION.md). If startup sulks, use
[Troubleshooting](docs/TROUBLESHOOTING.md) instead of randomly rotating knobs.

## Optional providers

### OpenAI

Set `AI_PROVIDER=openai`, provide `OPENAI_API_KEY` through the ignored `.env`
file or an approved secret manager, and choose an available `OPENAI_MODEL`.
OpenAI API usage is billed separately from ChatGPT. Keep keys project-scoped,
restrict access where practical, and rotate any exposed credential.

### Tavily web grounding

Set `TAVILY_API_KEY` to enable `/search` and automatic grounding for clearly
current-information prompts. Jarvis requests bounded summaries, caches
equivalent queries in process memory, appends source links to grounded answers,
and treats retrieved text as data rather than instructions.

## Commands

| Command                    | What it does                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `/ask prompt:<question>`   | Sends a bounded question, persona instructions, and recent channel or thread history to the selected AI provider.                           |
| `/search query:<question>` | Requires Tavily and forces current web grounding before the selected AI provider answers.                                                   |
| `/forget`                  | Deletes Jarvis-owned conversation history for the current guild channel or thread.                                                          |
| `/help`                    | Lists the available commands and safety boundary.                                                                                           |
| `/status`                  | Reports Discord configuration, SQLite health, selected provider configuration, and web-search configuration without making a model request. |

All commands are server-only. `/ask`, `/search`, and `/forget` enforce
`ALLOWED_CHANNEL_IDS`; an allowlisted parent channel also permits its threads.
Each thread still keeps separate history.

## Docker

Register commands from the host, then follow
[Deployment](docs/DEPLOYMENT.md) for the hardened Compose workflow. The
container exposes no inbound port, runs as a non-root user with a read-only root
filesystem, and persists SQLite data in the `jarvis-data` named volume.

If Jarvis runs in Docker Desktop while Ollama runs on the host, set:

```dotenv
OLLAMA_BASE_URL=http://host.docker.internal:11434
```

Native Jarvis uses `http://127.0.0.1:11434`. Do not publish Ollama to the
internet, and do not run native and containerized Jarvis at the same time
unless duplicate replies are somehow your product strategy.

## Security and data

The current release has an explicit no-server-mutation boundary. Jarvis cannot
modify pre-existing Discord content, roles, channels, permissions, members,
server settings, or webhooks. Two deliberate state changes remain:

- `/forget` deletes this bot's stored history for the current conversation.
- The operator-run registration script bulk-replaces this application's guild
  command definitions with the checked-in five-command set.

Jarvis also answers clearly unsupported action requests locally instead of
sending them to the model. That classifier is a user-experience guardrail, not
an authorization control. Real authority remains defined by implemented code,
Discord permissions, configuration, and operator-approved integrations.

Retention cleanup also removes expired bot-owned records, and the global stored
row cap evicts the oldest records after appends. Conversation history contains
prompts and successful responses in local SQLite, so protect the host, volume,
and backups. Logs are structured and content-free by design. Never attach
`.env`, databases, private identifiers, message contents, or unredacted logs to
an issue.

Read the [Security model](docs/SECURITY_MODEL.md) for controls and residual
risks, the [Security policy](SECURITY.md) for private reporting, and
[Operations](docs/OPERATIONS.md) for backup, restore, retention, and incident
handling.

## Development and validation

The standard quality gate is:

```powershell
npm test
npm run lint
npm run format:check
npm run build
npm run docs:check
```

`docs:check` deterministically inspects tracked Markdown and YAML, rejects
unfinished markers and likely credentials, resolves repository links, and
cross-checks environment keys and package commands against their documentation.
It deliberately does not read `.env`, databases, logs, `node_modules`, `dist`,
or `data`.

Use [Development](docs/DEVELOPMENT.md) for repository layout, watch commands,
test boundaries, and change expectations. See [Contributing](CONTRIBUTING.md)
before opening a change.

## Release and license

The current package and changelog release is `0.1.0`; the supported line is
`0.1.x`. Release actions are maintainer-owned and documented in
[Releases](docs/RELEASES.md) and the [Changelog](CHANGELOG.md).

Copyright 2026 Jim Higgins. All rights reserved. Except for the adapted
[Code of Conduct](CODE_OF_CONDUCT.md), which is licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), this repository is
proprietary software. Platform-required viewing or forking rights do not grant
a broader license to use, copy, modify, distribute, or sublicense it. External
contributions are not accepted without a separate written contribution
agreement, and submitting unsolicited code transfers no rights. Read the
[Proprietary license](LICENSE.md) and
[Contributing](CONTRIBUTING.md) before assuming otherwise. Optimism is not a
license grant.

## Documentation map

| Guide                                        | Purpose                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [Architecture](docs/ARCHITECTURE.md)         | Components, request flow, storage identity, trust boundaries, and extension seams          |
| [Configuration](docs/CONFIGURATION.md)       | Every environment key, default, validation rule, and safe operating note                   |
| [Discord setup](docs/DISCORD_SETUP.md)       | Application creation, intents, minimum permissions, installation, and command registration |
| [Development](docs/DEVELOPMENT.md)           | Local workflows, repository map, scripts, testing, and change boundaries                   |
| [Deployment](docs/DEPLOYMENT.md)             | Native Windows and Docker deployment, updates, backup, restore, and rollback               |
| [Operations](docs/OPERATIONS.md)             | Health, logs, provider checks, retention, recovery, and outage handling                    |
| [Troubleshooting](docs/TROUBLESHOOTING.md)   | Safe diagnosis and recovery by symptom                                                     |
| [Security model](docs/SECURITY_MODEL.md)     | Assets, threats, controls, residual risk, and no-mutation guarantees                       |
| [Extension guide](docs/extensions/README.md) | Disabled contracts and requirements for any future integration                             |
| [Roadmap](docs/ROADMAP.md)                   | Shipped, planned, later, and explicitly out-of-scope work                                  |
| [Releases](docs/RELEASES.md)                 | Versioning, validation gates, publication authority, and rollback                          |

Repository policies and project records:

- [Proprietary license](LICENSE.md)
- [Changelog](CHANGELOG.md)
- [Contributing](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Support](SUPPORT.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
