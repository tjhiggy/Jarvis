# Configuration

Jarvis loads `.env` through `dotenv` during application startup. Copy `.env.example` to `.env`; do not commit `.env`. All settings are parsed at startup, so restart the process after changing any value. `npm run register-commands` separately loads the registration subset and must be rerun after changing `MAX_INPUT_CHARS` or command definitions.

The table is the complete configuration contract from `.env.example` and `src/config/config.ts`. Defaults below are parser defaults. The committed example file intentionally selects Ollama, which overrides the parser's OpenAI-provider default when it is copied unchanged.

| Key                       | Required condition                     | Default                      | Purpose                                                                                        | Safe example                         | Sensitivity            |
| ------------------------- | -------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------ | ---------------------- |
| `DISCORD_TOKEN`           | Always; non-empty                      | None                         | Authenticates the Discord bot and command-registration client.                                 | `stored-in-secret-manager`           | Secret                 |
| `DISCORD_CLIENT_ID`       | Always; non-empty                      | None                         | Discord application ID used for command registration.                                          | `your-application-id`                | Identifier             |
| `DISCORD_GUILD_ID`        | Always; non-empty                      | None                         | Development guild targeted by registration.                                                    | `your-development-guild-id`          | Identifier             |
| `AI_PROVIDER`             | Optional; must be `openai` or `ollama` | `openai`                     | Selects the AI adapter.                                                                        | `ollama`                             | Operational            |
| `OPENAI_API_KEY`          | Non-empty when `AI_PROVIDER=openai`    | Empty string                 | Authenticates OpenAI Responses requests.                                                       | `stored-in-secret-manager`           | Secret                 |
| `OPENAI_MODEL`            | Optional; non-empty when supplied      | `gpt-5.6-luna`               | Model name passed to OpenAI.                                                                   | `gpt-5.6-luna`                       | Operational            |
| `OPENAI_TIMEOUT_MS`       | Optional integer, at least 1           | `45000`                      | Per-attempt OpenAI timeout in milliseconds.                                                    | `45000`                              | Operational            |
| `OPENAI_MAX_RETRIES`      | Optional integer from 0 to 10          | `3`                          | Retry count for retryable OpenAI failures.                                                     | `3`                                  | Operational            |
| `OLLAMA_BASE_URL`         | Optional valid `http` or `https` URL   | `http://127.0.0.1:11434`     | Base URL for the Ollama chat API.                                                              | `http://127.0.0.1:11434`             | Network detail         |
| `OLLAMA_MODEL`            | Optional; non-empty when supplied      | `gemma3:4b`                  | Model name sent to Ollama.                                                                     | `gemma3:4b`                          | Operational            |
| `OLLAMA_TIMEOUT_MS`       | Optional integer, at least 1           | `120000`                     | Per-attempt Ollama timeout in milliseconds.                                                    | `120000`                             | Operational            |
| `OLLAMA_MAX_RETRIES`      | Optional integer from 0 to 10          | `1`                          | Retry count for retryable Ollama failures.                                                     | `1`                                  | Operational            |
| `TAVILY_API_KEY`          | Optional                               | Empty string                 | Enables Tavily web grounding when non-empty.                                                   | `stored-in-secret-manager`           | Secret                 |
| `WEB_SEARCH_TIMEOUT_MS`   | Optional integer, at least 1           | `10000`                      | Tavily request timeout in milliseconds.                                                        | `10000`                              | Operational            |
| `WEB_SEARCH_CACHE_TTL_MS` | Optional integer, at least 1           | `3600000`                    | In-process cache lifetime for equivalent search queries in milliseconds.                       | `3600000`                            | Operational            |
| `WEB_SEARCH_MAX_RESULTS`  | Optional integer from 1 to 5           | `5`                          | Maximum Tavily results requested and used for grounding.                                       | `5`                                  | Operational            |
| `MAX_HISTORY_MESSAGES`    | Optional integer, at least 1           | `20`                         | Maximum stored messages included as model context before the current prompt.                   | `20`                                 | Data and cost control  |
| `MAX_STORED_MESSAGES`     | Optional integer, at least 1           | `10000`                      | Global SQLite row cap; oldest rows are removed after an append.                                | `10000`                              | Data retention         |
| `HISTORY_RETENTION_DAYS`  | Optional integer, at least 1           | `30`                         | Deletes stored rows older than this age during startup and approximately daily cleanup.        | `30`                                 | Data retention         |
| `DATABASE_PATH`           | Optional; non-empty when supplied      | `./data/discord-bot.db`      | SQLite database file path.                                                                     | `./data/discord-bot.db`              | Local data location    |
| `MAX_INPUT_CHARS`         | Optional integer, at least 1           | `12000`                      | Unicode-character limit for user prompts; command options are also capped by Discord at 6,000. | `12000`                              | Abuse and cost control |
| `RATE_LIMIT_REQUESTS`     | Optional integer, at least 1           | `5`                          | Requests permitted per guild/user rate-limit key within the window.                            | `5`                                  | Abuse and cost control |
| `RATE_LIMIT_WINDOW_MS`    | Optional integer, at least 1           | `60000`                      | Rate-limit window in milliseconds.                                                             | `60000`                              | Abuse and cost control |
| `ALLOWED_CHANNEL_IDS`     | Optional comma-separated IDs           | Empty set                    | Limits requests to named channels or their threads.                                            | `your-channel-id,another-channel-id` | Access boundary        |
| `RESTRAINED_CHANNEL_IDS`  | Optional comma-separated IDs           | Empty set                    | Uses the restrained persona mode in named channels or their threads.                           | `your-technical-channel-id`          | Operational            |
| `PERSONA_PROMPT_PATH`     | Optional; non-empty when supplied      | `./config/jarvis-persona.md` | Operator-controlled persona file loaded at startup.                                            | `./config/jarvis-persona.md`         | Trusted local content  |
| `LOG_LEVEL`               | Optional enum                          | `info`                       | Pino logging level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent`.           | `info`                               | Operational            |

## Provider and web-search behavior

`AI_PROVIDER=openai` makes `OPENAI_API_KEY` mandatory. The OpenAI model, timeout, and retry settings are then used by the Responses adapter. With `AI_PROVIDER=ollama`, an OpenAI key is not required; the process calls `OLLAMA_BASE_URL/api/chat` with the configured Ollama model. The loader accepts only HTTP or HTTPS base URLs and strips trailing slashes before use. Do not publish a local Ollama endpoint to the public internet.

An empty `TAVILY_API_KEY` leaves web grounding disabled. When configured, `/search` forces grounding and some prompts that indicate current information select it automatically. Tavily results are bounded, cached in process memory, and treated as untrusted evidence rather than instructions.

## Access, input, and retention bounds

An empty `ALLOWED_CHANNEL_IDS` allows requests in every guild channel where the bot can operate. Set an explicit production allowlist if the bot should be narrowly scoped. An allowlisted parent channel also admits its threads. An empty `RESTRAINED_CHANNEL_IDS` leaves all channels in the immersive persona mode; those IDs affect tone, not access.

`MAX_INPUT_CHARS` bounds the Unicode character count accepted by the conversation service. `MAX_HISTORY_MESSAGES` limits context sent to the provider, but does not by itself delete database rows. `MAX_STORED_MESSAGES` limits all retained SQLite rows after each append, while `HISTORY_RETENTION_DAYS` removes records older than the retention cutoff. Choose all three for the data volume and cost you are prepared to operate.

## Retry, persona, and restart rules

Provider retry counts are attempts after the first request and are bounded to 0 through 10. OpenAI and Ollama each use their own timeout and retry setting; web search has a timeout but no configuration field for retries. The persona path must point to a non-empty readable file with at most 8,000 Unicode characters. It is trusted operator content, not a place for credentials or Discord message text.

The live process does not reload configuration, persona, allowlists, models, or database paths. Restart it after edits. Register commands again after a `MAX_INPUT_CHARS` change because the registration script derives slash-option lengths from that setting.

See [Architecture](ARCHITECTURE.md) for how these settings are consumed and [Development](DEVELOPMENT.md) for a safe local workflow.
