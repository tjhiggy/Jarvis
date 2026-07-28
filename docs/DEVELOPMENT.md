# Development

Jarvis targets Node.js 22 or newer and uses npm with the committed lockfile. Local development is credentialed only at runtime; tests use dependency injection and mocks, so they do not need a Discord connection, a provider key, or an Ollama process.

## Install and configure locally

```powershell
npm ci
Copy-Item .env.example .env
```

Keep `.env` local and fill the three Discord values. For local Ollama, keep the example provider selection or set these values explicitly:

```powershell
ollama pull gemma3:4b
```

```dotenv
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=gemma3:4b
```

Start the Ollama service using its own supported local workflow, then register the commands in the development guild and run Jarvis:

```powershell
npm run register-commands
npm run dev
```

`npm run dev` watches `src/index.ts`. For the native compiled path, use:

```powershell
npm run build
npm start
```

The registration command changes this application's command set in the configured development guild. Do not run it against a guild you do not control. See [Discord setup](DISCORD_SETUP.md) for scope and permission details and [Configuration](CONFIGURATION.md) for every setting.

## Repository layout

| Path                            | Purpose                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `src/index.ts`                  | Application composition and lifecycle.                                       |
| `src/commands/`                 | Slash-command definitions and handlers.                                      |
| `src/config/`                   | Environment parsing and trusted persona loading.                             |
| `src/discord/`                  | Gateway-event normalization, access checks, and safe delivery.               |
| `src/services/`                 | Conversation policy, coordination, history, and provider orchestration.      |
| `src/openai/` and `src/ollama/` | Provider adapters behind `AIService`.                                        |
| `src/search/`                   | Optional Tavily grounding wrapper.                                           |
| `src/storage/`                  | `ConversationStore` contract and SQLite adapter.                             |
| `src/security/`                 | Event de-duplication and rate limiting.                                      |
| `tests/`                        | Vitest coverage for runtime, configuration, adapters, storage, and controls. |
| `scripts/register-commands.ts`  | Explicit development-guild command registration.                             |
| `config/jarvis-persona.md`      | Operator-controlled persona content loaded at startup.                       |

## Tests and quality checks

Run the full local quality set before proposing code changes:

```powershell
npm test
npm run lint
npm run format:check
npm run build
```

Use `npm run test:watch` while iterating. `npm run format` writes formatting to the repository, while `npm run format:check` only verifies it. `npm run lint` runs ESLint across the project, and `npm run build` type-checks and emits the configured TypeScript build.

Tests avoid live services by injecting factories or clients. Examples include the application dependencies for environment loading, storage, AI, Discord, logging, timers, process signals, and elapsed time; provider adapters accept mock clients or `fetch`; and command registration accepts a mock REST client. Keep that boundary intact. A unit test that needs a real bot token is not an integration test, it is a credential leak wearing a fake mustache.

## Safe debugging

Use `LOG_LEVEL=debug` only in a controlled environment and review output before sharing it. Do not paste `.env`, bot tokens, API keys, Discord IDs, raw message content, database files, or provider responses into issues or chats. `/status` is the safe in-Discord check for configured Discord, selected AI provider, web-search configuration, and database health; it does not make a model request.

For a controlled local run, test with a development guild, a narrow allowlist, and a non-sensitive prompt. Stop the native process with `Ctrl+C` so its signal handler stops accepting work, closes SQLite, and disconnects the Discord client.

## Working on the code

Changes to configuration parsing need matching configuration tests and updates to `.env.example` and [Configuration](CONFIGURATION.md). Changes to command definitions need command tests, documentation, and an explicit rerun of `npm run register-commands` in the development guild. Changes to the storage or provider boundaries need focused tests for error and retry behavior as well as the standard quality checks.

Jarvis is proprietary and all rights are reserved. Follow the repository's [contribution guidance](../CONTRIBUTING.md) and do not add code execution, server-administration, repository-write, or autonomous tool capabilities by accident.
