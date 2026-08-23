# Development

Jarvis targets Node.js 22 or newer and uses npm with the committed lockfile.
Install PowerShell 7 and make sure `pwsh` is on `PATH`; the documentation gate
invokes it through `npm run docs:check`. Local development is credentialed only
at runtime; tests use dependency injection and mocks, so they do not need a
Discord connection, a provider key, or an Ollama process.

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

For optional read-only fantasy standings, set `SLEEPER_LEAGUE_ID` to the
league's 8-to-20 digit public ID. No Sleeper credential is required.

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
npm run recovery:check
npm run recovery:verify
npm test
npm run lint
npm run format:check
npm run build
npm run features:check
npm run docs:check
```

Use `npm run test:watch` while iterating. `npm run format` writes formatting to
the repository, while `npm run format:check` only verifies it. `npm run lint`
runs ESLint across the project, `npm run build` type-checks and emits the
configured TypeScript build, and `npm run docs:check` validates tracked
documentation and GitHub YAML through PowerShell 7.

### Platform recovery verification

The versioned [platform recovery verification matrix](PLATFORM_RECOVERY_VERIFICATION.md)
is the recovery source of truth. It maps each v1.6 platform, storage,
scheduler, provider, and sanitization claim to a committed focused test and
operator recovery guidance.

- `npm run recovery:check` validates the typed catalog and confirms the
  committed matrix is current. It is read-only and uses no network.
- `npm run recovery:write` regenerates that committed matrix after an
  intentional catalog change. Review the diff, then commit it with the code or
  test change that made it necessary.
- `npm run recovery:verify` validates the matrix, executes the exact focused
  catalog evidence with a restricted disposable test environment, and writes
  `.artifacts/qa/platform-recovery.json`.

The receipt is local and git-ignored. Its allowlist contains scenario IDs,
repository-relative test files, aggregate counts, repository and Node versions,
duration, exit status, and the redaction result only. It never reads `.env`,
Discord state, provider credentials, or production SQLite data, and it must not
contain message content, raw IDs, URLs, headers, or secrets. Inspect only the
sanitized receipt when recording verification evidence.

The matrix deliberately leaves unproven recovery behavior visible with a linked
focused defect, rather than calling it shipped because a related test passes.
Do not remove or soften those rows without the executable regression that closes
the cited defect.

The versioned [shipped-feature verification matrix](SHIPPED_FEATURE_VERIFICATION.md)
is generated from the typed catalog. After changing command ownership,
configuration, evidence, or smoke coverage, run `npm run features:write` and
commit the regenerated report. `npm run features:check` is read-only and fails
when a registered Discord command is missing, duplicated, cites missing
evidence, or the committed report is stale.

The synthetic local-model comparison is opt-in and never reads Discord data.
Build first, then run one model at a time so Ollama unloads it before the next:

```powershell
npm run model:evaluate -- gemma3:4b
npm run model:evaluate -- qwen3:4b
```

Only aggregate score and latency are printed. Do not redirect provider
responses or Discord content into evaluation artifacts.

Tests avoid live services by injecting factories or clients. Examples include the application dependencies for environment loading, storage, AI, Discord, logging, timers, process signals, and elapsed time; provider adapters accept mock clients or `fetch`; and command registration accepts a mock REST client. Keep that boundary intact. A unit test that needs a real bot token is not an integration test, it is a credential leak wearing a fake mustache.

## Safe debugging

Use `LOG_LEVEL=debug` only in a controlled environment and review output before sharing it. Do not paste `.env`, bot tokens, API keys, Discord IDs, raw message content, database files, or provider responses into issues or chats. `/status` is the safe in-Discord check for configured Discord, selected AI provider, web-search configuration, and database health; it does not make a model request.

For a controlled local run, test with a development guild, a narrow allowlist, and a non-sensitive prompt. Stop the native process with `Ctrl+C` so its signal handler stops accepting work, closes SQLite, and disconnects the Discord client.

## Working on the code

Changes to configuration parsing need matching configuration tests and updates to `.env.example` and [Configuration](CONFIGURATION.md). Changes to command definitions need command tests, documentation, and an explicit rerun of `npm run register-commands` in the development guild. Changes to the storage or provider boundaries need focused tests for error and retry behavior as well as the standard quality checks.

Jarvis is proprietary and all rights are reserved. Follow the repository's [contribution guidance](../CONTRIBUTING.md) and do not add code execution, server-administration, repository-write, or autonomous tool capabilities by accident.
