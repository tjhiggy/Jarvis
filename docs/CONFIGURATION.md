# Configuration

`ENGAGEMENT_ENABLED=true` and `ENGAGEMENT_ADMIN_ROLE_IDS` are required before administrator engagement controls are available. No additional token, privileged intent, or Discord Administrator permission is used for `/engagement` operations.

Jarvis loads `.env` through `dotenv` during application startup. Copy `.env.example` to `.env`; do not commit `.env`. All settings are parsed at startup, so restart the process after changing any value. `npm run register-commands` separately loads the registration subset and must be rerun after changing `MAX_INPUT_CHARS`, `FAQ_CATALOG_PATH`, FAQ catalog content, or command definitions.

The table is the complete configuration contract from `.env.example` and `src/config/config.ts`. Defaults below are parser defaults. The committed example file intentionally selects Ollama, which overrides the parser's OpenAI-provider default when it is copied unchanged.

| Key                                       | Required condition                                                                                | Default                      | Purpose                                                                                                                                             | Safe example                           | Sensitivity            |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ---------------------- |
| `DISCORD_TOKEN`                           | Always; non-empty                                                                                 | None                         | Authenticates the Discord bot and command-registration client.                                                                                      | `stored-in-secret-manager`             | Secret                 |
| `DISCORD_CLIENT_ID`                       | Always; non-empty                                                                                 | None                         | Discord application ID used for command registration.                                                                                               | `your-application-id`                  | Identifier             |
| `DISCORD_GUILD_ID`                        | Always; non-empty                                                                                 | None                         | Development guild targeted by registration.                                                                                                         | `your-development-guild-id`            | Identifier             |
| `ADMIN_CONSOLE_ENABLED`                   | Optional; `true` or `false`                                                                       | `false`                      | Enables the localhost-only, read-only Command Deck dashboard.                                                                                       | `false`                                | Operational            |
| `ADMIN_CONSOLE_HOST`                      | Optional; `localhost` or `127.0.0.1`                                                              | `127.0.0.1`                  | Bind address for the local dashboard; public binds are rejected.                                                                                    | `127.0.0.1`                            | Access boundary        |
| `ADMIN_CONSOLE_PORT`                      | Optional integer from 0 to 65535                                                                  | `8787`                       | Local dashboard port. `0` lets the OS choose a port for tests.                                                                                      | `8787`                                 | Operational            |
| `ADMIN_CONSOLE_TOKEN`                     | Required when `ADMIN_CONSOLE_ENABLED=true`; non-empty secret, 32+ characters for remote mutations | Empty string                 | Dedicated write credential for preview/confirm/cancel/retry/rollback; never embed or persist it in Sites.                                           | `stored-in-secret-manager`             | Secret                 |
| `COMMAND_DECK_API_TOKEN`                  | Optional; blank disables the remote API; at least 32 characters when set                          | Empty string                 | Dedicated read credential for the private Sites snapshot API; must differ from the write credential.                                                | `stored-in-secret-manager`             | Secret                 |
| `COMMAND_DECK_API_ALLOWED_ORIGINS`        | Optional comma-separated exact HTTPS origins; requires the read token                             | Empty list                   | Allows only the private Sites origin for reads and mutation CORS/preflight; paths, credentials, HTTP, wildcards, and trailing slashes are rejected. | `https://deck.example.com`             | Access boundary        |
| `COMMAND_DECK_API_RATE_LIMIT`             | Optional integer from 1 to 1,000                                                                  | `30`                         | Maximum accepted read requests per fixed window.                                                                                                    | `30`                                   | Abuse control          |
| `COMMAND_DECK_API_WINDOW_SECONDS`         | Optional integer from 1 to 3,600                                                                  | `60`                         | Fixed rate-limit window in seconds.                                                                                                                 | `60`                                   | Abuse control          |
| `COMMAND_DECK_API_MAX_CLOCK_SKEW_SECONDS` | Optional integer from 1 to 300                                                                    | `60`                         | Freshness and replay-retention window for request metadata.                                                                                         | `60`                                   | Replay control         |
| `AI_PROVIDER`                             | Optional; must be `openai` or `ollama`                                                            | `openai`                     | Selects the AI adapter.                                                                                                                             | `ollama`                               | Operational            |
| `OPENAI_API_KEY`                          | Non-empty when `AI_PROVIDER=openai`                                                               | Empty string                 | Authenticates OpenAI Responses requests.                                                                                                            | `stored-in-secret-manager`             | Secret                 |
| `OPENAI_MODEL`                            | Optional; non-empty when supplied                                                                 | `gpt-5.6-luna`               | Model name passed to OpenAI.                                                                                                                        | `gpt-5.6-luna`                         | Operational            |
| `OPENAI_TIMEOUT_MS`                       | Optional integer, at least 1                                                                      | `45000`                      | Per-attempt OpenAI timeout in milliseconds.                                                                                                         | `45000`                                | Operational            |
| `OPENAI_MAX_RETRIES`                      | Optional integer from 0 to 10                                                                     | `3`                          | Retry count for retryable OpenAI failures.                                                                                                          | `3`                                    | Operational            |
| `IMAGE_GENERATION_ENABLED`                | Optional `true` or `false`; enabling also requires an OpenAI key and image channel                | `false`                      | Enables the administrator-only, one-image generation command.                                                                                       | `false`                                | Feature gate           |
| `IMAGE_GENERATION_CHANNEL_ID`             | Blank or one 17-to-20 digit Discord channel ID                                                    | Empty string                 | Sole approved destination for generated images.                                                                                                     | `1536175231373148181`                  | Access boundary        |
| `IMAGE_GENERATION_MODEL`                  | Optional; non-empty when supplied                                                                 | `gpt-image-1-mini`           | Explicit OpenAI image model.                                                                                                                        | `gpt-image-1-mini`                     | Cost control           |
| `IMAGE_GENERATION_TIMEOUT_MS`             | Optional integer from 1,000 to 180,000                                                            | `60000`                      | Timeout for one image request.                                                                                                                      | `60000`                                | Operational            |
| `OLLAMA_BASE_URL`                         | Optional valid `http` or `https` URL                                                              | `http://127.0.0.1:11434`     | Base URL for the Ollama chat API.                                                                                                                   | `http://127.0.0.1:11434`               | Network detail         |
| `OLLAMA_MODEL`                            | Optional; non-empty when supplied                                                                 | `gemma3:4b`                  | Model name sent to Ollama.                                                                                                                          | `gemma3:4b`                            | Operational            |
| `OLLAMA_TIMEOUT_MS`                       | Optional integer, at least 1                                                                      | `120000`                     | Per-attempt Ollama timeout in milliseconds.                                                                                                         | `120000`                               | Operational            |
| `OLLAMA_MAX_RETRIES`                      | Optional integer from 0 to 10                                                                     | `1`                          | Retry count for retryable Ollama failures.                                                                                                          | `1`                                    | Operational            |
| `TAVILY_API_KEY`                          | Optional                                                                                          | Empty string                 | Enables Tavily balanced automatic grounding and forced `/search` when non-empty.                                                                    | `stored-in-secret-manager`             | Secret                 |
| `WEB_SEARCH_TIMEOUT_MS`                   | Optional integer, at least 1                                                                      | `10000`                      | Tavily request timeout in milliseconds.                                                                                                             | `10000`                                | Operational            |
| `WEB_SEARCH_CACHE_TTL_MS`                 | Optional integer, at least 1                                                                      | `3600000`                    | In-process cache lifetime for equivalent search queries in milliseconds.                                                                            | `3600000`                              | Operational            |
| `WEB_SEARCH_MAX_RESULTS`                  | Optional integer from 1 to 5                                                                      | `5`                          | Maximum Tavily results requested and used for grounding.                                                                                            | `5`                                    | Operational            |
| `MAX_HISTORY_MESSAGES`                    | Optional integer, at least 1                                                                      | `20`                         | Maximum stored messages included as model context before the current prompt.                                                                        | `20`                                   | Data and cost control  |
| `MAX_STORED_MESSAGES`                     | Optional integer, at least 1                                                                      | `10000`                      | Global SQLite row cap; oldest rows are removed after an append.                                                                                     | `10000`                                | Data retention         |
| `HISTORY_RETENTION_DAYS`                  | Optional integer, at least 1                                                                      | `30`                         | Deletes stored rows older than this age during startup and approximately daily cleanup.                                                             | `30`                                   | Data retention         |
| `DATABASE_PATH`                           | Optional; non-empty when supplied                                                                 | `./data/discord-bot.db`      | SQLite database file path.                                                                                                                          | `./data/discord-bot.db`                | Local data location    |
| `JARVIS_VERSION`                          | Optional; non-empty when supplied                                                                 | Package version              | Trusted release version shown in `/status` and runtime answers.                                                                                     | `1.6.0`                                | Build metadata         |
| `JARVIS_COMMIT_SHA`                       | Optional; non-empty when supplied                                                                 | `development`                | Trusted source revision shown in `/status`; set it from the deployed commit, never from Discord.                                                    | `abc1234`                              | Build metadata         |
| `JARVIS_BUILD_TIMESTAMP`                  | Optional; non-empty when supplied                                                                 | `unknown`                    | Trusted UTC build timestamp shown in `/status`.                                                                                                     | `2026-08-09T14:30:00Z`                 | Build metadata         |
| `JARVIS_ENVIRONMENT`                      | Optional; non-empty when supplied                                                                 | `development`                | Deployment label shown in `/status`; it is not host inspection.                                                                                     | `production`                           | Build metadata         |
| `MAX_INPUT_CHARS`                         | Optional integer, at least 1                                                                      | `12000`                      | Unicode-character limit for user prompts; command options are also capped by Discord at 6,000.                                                      | `12000`                                | Abuse and cost control |
| `RATE_LIMIT_REQUESTS`                     | Optional integer, at least 1                                                                      | `5`                          | Requests permitted per guild/user rate-limit key within the window.                                                                                 | `5`                                    | Abuse and cost control |
| `RATE_LIMIT_WINDOW_MS`                    | Optional integer, at least 1                                                                      | `60000`                      | Rate-limit window in milliseconds.                                                                                                                  | `60000`                                | Abuse and cost control |
| `ALLOWED_CHANNEL_IDS`                     | Optional comma-separated IDs                                                                      | Empty set                    | Limits requests to named channels or their threads.                                                                                                 | `your-channel-id,another-channel-id`   | Access boundary        |
| `RESTRAINED_CHANNEL_IDS`                  | Optional comma-separated IDs                                                                      | Empty set                    | Uses the restrained persona mode in named channels or their threads.                                                                                | `your-technical-channel-id`            | Operational            |
| `PERSONA_PROMPT_PATH`                     | Optional; non-empty when supplied                                                                 | `./config/jarvis-persona.md` | Operator-controlled persona file loaded at startup.                                                                                                 | `./config/jarvis-persona.md`           | Trusted local content  |
| `FAQ_CATALOG_PATH`                        | Optional; non-empty when supplied                                                                 | `./config/faq.json`          | Operator-controlled approved FAQ catalog loaded before Discord login.                                                                               | `./config/faq.json`                    | Trusted local content  |
| `SLEEPER_LEAGUE_ID`                       | Optional; blank or an 8-to-20 digit ID                                                            | Empty string                 | Enables read-only `/fantasy standings` for one Sleeper league; no API key is required.                                                              | `1388545313588924416`                  | Public identifier      |
| `GITHUB_OWNER`                            | Optional; required together with `GITHUB_REPO` to enable GitHub commands                          | Empty string                 | Approved GitHub owner or organization for `/github` reads and `/request` issue creation.                                                            | `tjhiggy`                              | Public identifier      |
| `GITHUB_REPO`                             | Optional; required together with `GITHUB_OWNER` to enable GitHub commands                         | Empty string                 | Approved repository for `/github` reads and administrator `/request` issue creation.                                                                | `Jarvis`                               | Public identifier      |
| `GITHUB_TOKEN`                            | Optional for public `/github` reads; required for `/request` issue creation                       | Empty string                 | Public lookups work without it. `/request` uses this repository-scoped GitHub App or fine-grained bot token with Issues: Read and write, not a personal account token, and fails closed if it is missing or rejected. Never logged or shown in Discord. | `stored-in-secret-manager`             | Secret                 |
| `GITHUB_TIMEOUT_MS`                       | Optional integer from 1,000 to 30,000                                                             | `8000`                       | Timeout for each GitHub API request.                                                                                                                | `8000`                                 | Operational            |
| `POLL_ADMIN_USER_IDS`                     | Blank only when `POLL_VOTER_SECRET` is also blank; otherwise one or more 17-to-20 digit IDs       | Empty set                    | Exact Discord user IDs authorized to create and close polls.                                                                                        | `12345678901234567,98765432109876543`  | Access boundary        |
| `POLL_VOTER_SECRET`                       | Blank only when `POLL_ADMIN_USER_IDS` is also blank; otherwise at least 32 characters             | Empty string                 | Private HMAC key for anonymous poll voter tokens.                                                                                                   | `stored-in-secret-manager`             | Secret                 |
| `POLL_RETENTION_DAYS`                     | Optional integer, at least 1                                                                      | `30`                         | Retains terminal poll rows and final aggregates for this age before cleanup.                                                                        | `30`                                   | Data retention         |
| `POLL_EXPIRY_CHECK_SECONDS`               | Optional integer, at least 1                                                                      | `30`                         | Interval for bounded poll expiry, synchronization retry, and retention work after Discord login.                                                    | `30`                                   | Operational            |
| `ENGAGEMENT_ENABLED`                      | Optional `true` or `false`                                                                        | `false`                      | Enables the engagement platform only after its channels and administrator roles are configured.                                                     | `true`                                 | Feature gate           |
| `ENGAGEMENT_INTRODUCTION_CHANNEL_ID`      | Optional blank or one 17-to-20 digit Discord channel ID                                           | Empty string                 | Sole destination for guided introductions.                                                                                                          | `12345678901234567`                    | Access boundary        |
| `ENGAGEMENT_SUGGESTION_CHANNEL_ID`        | Optional blank or one 17-to-20 digit Discord channel ID                                           | Empty string                 | Sole destination for normalized suggestion cards.                                                                                                   | `12345678901234567`                    | Access boundary        |
| `ENGAGEMENT_EVENT_CHANNEL_ID`             | Optional blank or one 17-to-20 digit Discord channel ID                                           | Empty string                 | Sole destination for event cards and RSVP controls.                                                                                                 | `12345678901234567`                    | Access boundary        |
| `ENGAGEMENT_RECAP_CHANNEL_ID`             | Optional blank or one 17-to-20 digit Discord channel ID                                           | Empty string                 | Sole destination for community recaps.                                                                                                              | `12345678901234567`                    | Access boundary        |
| `ENGAGEMENT_ACTIVITY_CHANNEL_ID`          | Optional blank or one 17-to-20 digit Discord channel ID                                           | Empty string                 | Sole destination for the bounded community activity.                                                                                                | `12345678901234567`                    | Access boundary        |
| `ENGAGEMENT_BIRTHDAY_CHANNEL_ID`          | Optional blank or one 17-to-20 digit Discord channel ID                                           | Empty string                 | Sole destination for privacy-safe birthday announcements.                                                                                           | `12345678901234567`                    | Access boundary        |
| `ENGAGEMENT_RSS_CHANNEL_ID`               | Optional blank or one 17-to-20 digit Discord channel ID                                           | Empty string                 | Sole destination for approved RSS notifications; blank disables RSS runtime controls.                                                               | `12345678901234567`                    | Access boundary        |
| `ENGAGEMENT_RSS_ALLOWED_HOSTS`            | Comma-separated exact hostnames; HTTPS only                                                       | Empty string                 | Allowlist for RSS feed URLs. Private, local, and unlisted hosts are rejected.                                                                       | `news.example.com,updates.example.org` | Security boundary      |
| `ENGAGEMENT_PROACTIVE_CATALOG_PATH`       | Optional path to an operator-controlled JSON array                                                | Empty string                 | Enables approved proactive posts; blank disables the proactive catalog and scheduler.                                                               | `./config/proactive-prompts.json`      | Trusted local content  |
| `ENGAGEMENT_ROLE_MENU_OPTIONS`            | Optional comma-separated `value:label:roleId` entries                                             | Empty string                 | Safe allowlist for `/roles`; Jarvis only assigns these configured roles and never creates or edits roles.                                           | `fortnite:Fortnite:12345678901234567`  | Access boundary        |
| `ENGAGEMENT_ADMIN_ROLE_IDS`               | Required when engagement is enabled; comma-separated 17-to-20 digit Discord role IDs              | Empty set                    | Role allowlist for engagement management. It does not grant Discord permissions.                                                                    | `12345678901234567,23456789012345678`  | Access boundary        |
| `ENGAGEMENT_RECAP_SCHEDULE`               | Optional blank or `DAY HH:MM` with an uppercase weekday and 24-hour time                          | Empty string                 | Weekly recap trigger; requires enabled engagement and a recap channel.                                                                              | `MONDAY 09:30`                         | Operational            |
| `ENGAGEMENT_RECAP_TIMEZONE`               | Optional valid IANA timezone                                                                      | `UTC`                        | Timezone used to interpret the recap schedule.                                                                                                      | `America/New_York`                     | Operational            |
| `ENGAGEMENT_RETENTION_DAYS`               | Optional integer from 1 to 90                                                                     | `30`                         | Maximum age for engagement records before scheduled cleanup.                                                                                        | `30`                                   | Data retention         |
| `ENGAGEMENT_MAX_RECORDS_PER_USER`         | Optional integer from 1 to 25                                                                     | `5`                          | Per-user cap for active engagement records of a feature type.                                                                                       | `5`                                    | Abuse control          |
| `ENGAGEMENT_MAX_PARTICIPANTS`             | Optional integer from 2 to 1000                                                                   | `100`                        | Maximum participants accepted for one configured event or activity.                                                                                 | `100`                                  | Abuse control          |
| `ENGAGEMENT_QUIET_NUDGE_EARTHLINGS_CHANNEL_ID` | Optional blank or one 17-to-20 digit Discord channel ID                                      | Empty string                 | Sole destination for the main crew quiet-channel nudge; blank disables that destination.                                                            | `953011731356086284`                   | Access boundary        |
| `ENGAGEMENT_QUIET_NUDGE_TEST_CHANNEL_ID`  | Optional blank or one 17-to-20 digit Discord channel ID                                           | Empty string                 | Sole destination for the proof quiet-channel nudge; blank disables that destination.                                                                | `1536175231373148181`                  | Access boundary        |
| `ENGAGEMENT_QUIET_NUDGE_EARTHLINGS_WINDOW_MINUTES` | Optional integer of at least 1                                                          | `1440`                       | Minutes of human silence required before Jarvis may nudge `ENGAGEMENT_QUIET_NUDGE_EARTHLINGS_CHANNEL_ID` once per quiet stretch.                    | `1440`                                 | Operational            |
| `ENGAGEMENT_QUIET_NUDGE_TEST_WINDOW_MINUTES` | Optional integer of at least 1                                                             | `5`                          | Minutes of human silence required before Jarvis may nudge `ENGAGEMENT_QUIET_NUDGE_TEST_CHANNEL_ID` once per quiet stretch.                          | `5`                                    | Operational            |
| `LOG_LEVEL`                               | Optional enum                                                                                     | `info`                       | Pino logging level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, or `silent`.                                                                | `info`                                 | Operational            |

The private Sites project stores three values that never belong in Jarvis
`.env`: `COMMAND_DECK_API_BASE_URL` (Jarvis tunnel origin),
`COMMAND_DECK_READ_TOKEN` (copy of `COMMAND_DECK_API_TOKEN`, server-side only),
and `COMMAND_DECK_PAGE_ORIGIN` (exact HTTPS Sites page origin). The browser
never receives the read token. See [Sites Command Deck](SITES_COMMAND_DECK.md).

## Shipboard broadcast configuration

`ALLOWED_CHANNEL_IDS` is the non-negotiable delivery destination allowlist for
scheduled broadcasts other than RSS, whose destination is checked against its
explicit configured RSS channel. A persisted policy may name only a configured
destination; it cannot add a new channel. Startup creates a missing policy for
each configured category. RSS starts enabled in UTC with digest mode on and no
minimum interval. Proactive starts enabled in UTC with quiet hours from 23:00
through 08:00 and a six-hour minimum interval. Recap, event-reminder, birthday,
and trivia policies start enabled using `ENGAGEMENT_RECAP_TIMEZONE`, with no
quiet period or cadence interval. Existing policy rows survive restart.

Quiet hours use the policy's IANA timezone. A start equal to the end means no
quiet period; a range crossing midnight, such as 23:00 to 08:00, suppresses
both late-night and early-morning delivery. Policy values are durable operator
state, not environment variables: change them through the local Command Deck,
then restart only when changing environment configuration.

`ENGAGEMENT_PROACTIVE_CATALOG_PATH` is read before Discord login. Its JSON must
be an array of at most 100 strictly shaped prompts. Each prompt has a unique
lowercase hyphenated ID of at most 64 characters, a category of at most 64
characters, active boolean, text of 1 through 1,000 characters, and optional
offset ISO start/end timestamps where start precedes end. `@everyone`,
`@here`, and role mentions are rejected. The catalog is an administrator-owned
local file, never a Discord-editable input, and changing it requires restart.

All environment values are validated before login. `ENGAGEMENT_ENABLED=true`
still requires at least one engagement channel and one administrator role.
RSS feed URLs still require HTTPS and an exact configured host. Restart after
any `.env` change; then run command registration when command definitions have
changed.

## Sleeper behavior

When `SLEEPER_LEAGUE_ID` is blank, `/fantasy standings` reports that the league
integration is not configured. When set, Jarvis reads public Sleeper rosters
and user display names only. Restart Jarvis after changing it. The integration
never changes lineups, waivers, trades, rosters, league settings, or Discord
settings.

The `/fantasy player` command uses the same public, read-only Sleeper boundary.
It validates the player identifier locally, requires a season, optionally
accepts a week, and returns only a bounded set of numeric statistics. It does
not accept arbitrary URLs or provider credentials.

## Provider and web-search behavior

`AI_PROVIDER=openai` makes `OPENAI_API_KEY` mandatory. The OpenAI model, timeout, and retry settings are then used by the Responses adapter. With `AI_PROVIDER=ollama`, an OpenAI key is not required; the process calls `OLLAMA_BASE_URL/api/chat` with the configured Ollama model. The loader accepts only HTTP or HTTPS base URLs and strips trailing slashes before use. Do not publish a local Ollama endpoint to the public internet.

An empty `TAVILY_API_KEY` leaves web grounding disabled. When configured,
`/search` forces grounding, while balanced automatic routing selects current
information and evidence-sensitive factual claims such as history, government
programs, named-entity relationships, statistics, and high-stakes medical,
legal, or financial questions. Basic definitions, supplied-text work, ordinary
drafting or creative requests, and timeless coding help normally stay local.

Each automatic search that is not served from the in-process cache sends a
Tavily request and consumes provider usage, so it adds external-search latency
as well as provider usage. Equivalent normalized queries within the cache
lifetime avoid another request. Tavily results are bounded, sanitized, and
treated as untrusted evidence rather than instructions; routing is a heuristic,
not a fact guarantee or an authorization control.

## Access, input, and retention bounds

An empty `ALLOWED_CHANNEL_IDS` allows requests in every guild channel where the bot can operate. Set an explicit production allowlist if the bot should be narrowly scoped. An allowlisted parent channel also admits its threads. An empty `RESTRAINED_CHANNEL_IDS` leaves all channels in the immersive persona mode; those IDs affect tone, not access.

`MAX_INPUT_CHARS` bounds the Unicode character count accepted by the conversation service. `MAX_HISTORY_MESSAGES` limits context sent to the provider, but does not by itself delete database rows. `MAX_STORED_MESSAGES` limits all retained SQLite rows after each append, while `HISTORY_RETENTION_DAYS` removes records older than the retention cutoff. Choose all three for the data volume and cost you are prepared to operate.

## Optional anonymous poll configuration

Polls are disabled only when **both** `POLL_ADMIN_USER_IDS` and
`POLL_VOTER_SECRET` are blank. Supplying one without the other is an invalid
startup and command-registration configuration. When enabled,
`POLL_ADMIN_USER_IDS` must contain comma-separated 17-to-20 digit Discord user
IDs, and `POLL_VOTER_SECRET` must contain at least 32 characters. It is an
authorization allowlist, not a Discord role or permission grant.

### Command-specific authorization

Jarvis uses explicit command scopes rather than Discord's broad Administrator
permission. `/config` shows the current read-only authorization contract to
configured administrators. Engagement administration and approved-knowledge
moderation use the roles in `ENGAGEMENT_ADMIN_ROLE_IDS`; poll creation and
early closure use the exact user IDs in `POLL_ADMIN_USER_IDS`. Ordinary
questions, personal reminders, birthdays, LFG, and role-menu selection remain
available to members subject to channel allowlists and feature configuration.

This mapping is an application boundary, not a Discord permission grant. It
cannot create roles, change role hierarchy, modify channels, or alter server
settings. Keep the bot's Discord permissions at the documented minimum and
allowlist only the roles it may assign.

`POLL_VOTER_SECRET` is sensitive. Put it in the same approved secret boundary
as the bot token, never in source, logs, screenshots, or issue text. Jarvis
uses it to derive a per-poll HMAC voter token. It does not store the raw voter
ID in poll records. The registration script consumes only the enabled/disabled
result, never the administrator IDs or secret.

Do not rotate `POLL_VOTER_SECRET` while active polls exist. Close or allow all
active polls to expire, wait for their messages to synchronize, rotate the
secret through the approved secret source, then restart and register commands
if the enabled state changed. Changing the secret while a poll is open would
make prior anonymous voter tokens incomparable and can allow an unintended
second selection.

`POLL_RETENTION_DAYS` applies to closed, failed, and orphaned poll rows. Closing
a poll immediately removes its individual voter tokens but leaves aggregate
totals for the retention window. `POLL_EXPIRY_CHECK_SECONDS` controls a
single-process scheduler that closes overdue polls, retries safe message
synchronization, and runs poll retention cleanup in bounded batches.

## Optional engagement configuration

Engagement is disabled when `ENGAGEMENT_ENABLED` is absent, blank, or `false`.
Enabling it requires at least one configured engagement channel and at least
one administrator role ID. Each non-blank channel setting is an independent
allowlist: future engagement features may read or post only in their named
channel, never by scanning ordinary guild chat. Blank feature-channel settings
leave that feature unavailable.

`ENGAGEMENT_ADMIN_ROLE_IDS` is an application authorization allowlist, not a
Discord role grant. Administrators must still have the channel permissions
needed to invoke application commands. `ENGAGEMENT_RECAP_SCHEDULE` uses an
uppercase weekday and 24-hour local time, for example `MONDAY 09:30`; it is
valid only with enabled engagement and a configured recap channel. The timezone
must be a valid IANA name. No schedule means no automatic recap: administrators
may still use `/recap preview`, but `/recap enable` and `/recap resume` refuse
to enable scheduled posting until the schedule is configured.

Disposable engagement records are retained for `ENGAGEMENT_RETENTION_DAYS`, from 1 through
90 days. The per-user and participant caps are hard startup limits, not hints
for a later handler to ignore. Restart after any engagement configuration
change; re-register commands after enabling engagement or changing the
introduction channel. `/introduce` posts only to
`ENGAGEMENT_INTRODUCTION_CHANNEL_ID`; `/introduce preview` creates a private
draft with an optional preferred name (defaulting to the member's Discord display
name) and owner-bound Confirm and Cancel buttons (the UUID commands remain as
a fallback) and `/introduce confirm` posts it, while `/introduction id:<id>` is the
owner-only deletion path for its SQLite record and bot-owned card. Retention
cleanup runs after Discord is ready, removes expired bot-owned cards before
deleting their records, and marks a failed card deletion `cleanup_pending` so
generic SQLite cleanup cannot erase the retry state.
Active opt-outs, recap enablement, and guild pause preferences are control
state, not expiring content. Retention cleanup never removes them; only the
corresponding explicit opt-in, recap control, or resume command changes them.

Suggestions use the same private-preview pattern: `/suggest preview` offers
owner-bound Confirm and Cancel buttons, while `/suggest confirm` remains a
UUID fallback, posting only to `ENGAGEMENT_SUGGESTION_CHANNEL_ID`.
`/suggestion delete id:<id>` lets the author remove an open suggestion and its
bot-owned card before a configured administrator triages it. The administrator role allowlist may
acknowledge, defer, resolve, or archive bot-owned suggestion cards. These
actions change only retained Jarvis state; they do not create GitHub issues or
perform other external writes.

If Discord accepts a suggestion card but its message ID cannot be persisted,
Jarvis records a cleanup-pending recovery entry with the card ID and retries
removal after restart. If that recovery record itself cannot be written, Jarvis
returns a private administrator-cleanup message and emits a structured log with
only guild and suggestion IDs.

`/trivia start` is available only in `ENGAGEMENT_ACTIVITY_CHANNEL_ID`. Each
round uses the checked-in curated catalog, expires after one minute, and is
also checked by a bounded 15-second in-process expiry scheduler. SQLite allows
only one open round per guild and activity channel, including concurrent starts.
Members can use `/trivia opt-out` from any server channel to stop future
participation and delete their retained trivia participant record; `/trivia
opt-in` removes that opt-out marker for future rounds. Neither command exposes
answer text, scores, XP, or a leaderboard.

For exact data fields, deletion semantics, scheduler behavior, and operations,
see the [Engagement runbook](ENGAGEMENT_RUNBOOK.md). Every engagement setting
is parsed only at startup; restart the single process after changing one.

## Retry, persona, and restart rules

Provider retry counts are attempts after the first request and are bounded to 0 through 10. OpenAI and Ollama each use their own timeout and retry setting; web search has a timeout but no configuration field for retries. The persona path must point to a non-empty readable file with at most 8,000 Unicode characters. It is trusted operator content, not a place for credentials or Discord message text.

The live process does not reload configuration, persona, FAQ catalog,
allowlists, models, poll settings, or database paths. Restart it after edits.
Register commands again after a `MAX_INPUT_CHARS` change, FAQ catalog change,
or poll enablement change because the registration script derives slash-option
lengths, topic choices, and optional poll commands from those settings.

See [Architecture](ARCHITECTURE.md) for how these settings are consumed and [Development](DEVELOPMENT.md) for a safe local workflow.

## Personal reminder behavior

Reminders add no environment variables, gateway intents, or Discord
permissions. They use `DATABASE_PATH`, `ALLOWED_CHANNEL_IDS`, and the existing
rate-limit settings: up to 10 active reminders per guild and owner, a 1-minute
to 30-day duration, and 500 trimmed characters. Optional personal recurrence
uses the same duration bound for `until` and stays on one stored row. Responses
are ephemeral; delivery returns to the original allowed channel or thread and
mentions only its owner. `/forget` remains separate conversation-history
deletion. The scheduler retries transient delivery around 1, 5, and 15 minutes
and retains terminal rows for seven days. DMs, exact date/time or timezones,
and shared-reminder recurrence are not configurable because they do not exist.
