# Architecture

Jarvis is a single Node.js process. It receives Discord gateway events, applies local request controls, optionally grounds a question with web-search results, calls the selected AI provider, and stores only its own conversation records in SQLite. There is no HTTP server or inbound listening port in the application.

## Components

| Component               | Responsibility                                                                                                                                                                                                                                                                                                    | Source                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Application composition | Loads configuration, persona, and approved catalogs before constructing adapters or logging into Discord; starts conversation, reminder, poll, engagement, birthday, and proactive maintenance after login, and closes resources on `SIGINT` or `SIGTERM`.                                                        | `src/index.ts`                                                                                                            |
| Configuration           | Parses and validates environment settings into immutable configuration objects.                                                                                                                                                                                                                                   | `src/config/config.ts`                                                                                                    |
| Discord adapter         | Accepts guild mentions and chat-input commands, checks message permissions, derives channel or thread context, neutralizes reply mentions, and chunks replies.                                                                                                                                                    | `src/discord/handlers.ts`, `src/commands/handlers.ts`, `src/discord/delivery.ts`, `src/utils/chunk-response.ts`           |
| Command definitions     | Defines the current chat-input command surface, including knowledge administration, bounded engagement, read-only Sleeper and GitHub integrations, and adds `/poll` and `/poll-close` only when polls are configured.                                                                                             | `src/commands/definitions.ts`                                                                                             |
| FAQ catalog             | Validates and freezes 1 to 25 entries from the active approved local catalog, provides ID lookup, and rejects invalid content with a sanitized configuration error.                                                                                                                                               | `src/faq/faq-catalog.ts`, default `config/faq.json`                                                                       |
| Conversation service    | Owns shared prompt normalization, input validation, channel access, event de-duplication, per-guild/user rate limits, deterministic response-style selection, unsupported-action UX responses, persona mode, history reads, and coordinated persistence.                                                          | `src/services/conversation-service.ts`, `src/services/response-style.ts`, `src/security/unsupported-action-classifier.ts` |
| AI providers            | Implements the shared AI boundary for OpenAI Responses and Ollama chat. Each runtime response is capped at 1,000 output tokens by application composition.                                                                                                                                                        | `src/openai/openai-service.ts`, `src/ollama/ollama-service.ts`, `src/index.ts`                                            |
| Web grounding           | Uses Tavily only when configured and either forced by `/search` or selected by the balanced evidence-routing heuristic.                                                                                                                                                                                           | `src/search/web-search.ts`                                                                                                |
| Storage                 | Defines the conversation-store boundary and provides the SQLite implementation.                                                                                                                                                                                                                                   | `src/storage/conversation-store.ts`, `src/storage/sqlite-conversation-store.ts`                                           |
| Polls                   | Provides opt-in administrator-created anonymous polls, HMAC voter tokens, aggregate storage, safe bot-owned message updates, and bounded lifecycle maintenance.                                                                                                                                                   | `src/polls/`                                                                                                              |
| Personal reminders      | Separates request validation, durable records, owner-only Discord delivery, and non-overlapping maintenance from conversations and polls.                                                                                                                                                                         | `src/reminders/`                                                                                                          |
| Sleeper integration     | Reads one configured public Sleeper league's rosters, owner names, standings, weekly matchup data, and bounded player statistics for read-only responses; missing or unavailable data is reported without guessing.                                                                                               | `src/sleeper/`, `src/commands/handlers.ts`                                                                                |
| GitHub integration      | Reads metadata, issues, and pull requests from one configured repository; authentication is optional and all repository mutations are out of scope.                                                                                                                                                               | `src/github/`, `src/commands/handlers.ts`                                                                                 |
| Disabled extensions     | Declares disabled-by-default, operator-approved extension shapes; it does not implement or wire tools.                                                                                                                                                                                                            | `src/extensions/contracts.ts`                                                                                             |
| Command registration    | Bulk-registers this application's command definitions in the configured development guild.                                                                                                                                                                                                                        | `scripts/register-commands.ts`                                                                                            |
| Command analytics       | Phase 0 shared instrumentation boundary for aggregate command usage, delivery outcomes, scheduler health, provider readiness, engagement adoption, and opt-in or opt-out metrics. The contract excludes raw message content and secrets; persistence and Admin Command Deck exposure remain later Phase 0 slices. | `src/platform/contracts.ts`, `src/platform/instrumentation.ts`                                                            |

## Request flow

```mermaid
flowchart TD
    A["Discord gateway event"] --> B{"Mention or chat-input command?"}
    B -->|"No"| X["Ignore"]
    B -->|"Yes"| C["Normalize guild, channel or thread, user, event, and prompt"]
    C --> D{"Allowlist and, for mentions, Discord channel permissions pass?"}
    D -->|"No"| Y["Ignore or return safe unavailable response"]
    D -->|"Yes"| E{"Event is new?"}
    E -->|"No"| Z["Return duplicate-safe response"]
    E -->|"Yes"| F{"Per guild/user rate limit passes?"}
    F -->|"No"| R["Return safe rate-limit response"]
    F -->|"Yes"| G["Coordinate this guild plus conversation's storage read and write transitions"]
    G --> H["Persist user message"]
    H --> Q{"Clearly unsupported action request?"}
    Q -->|"Yes"| N["Persist local UX response"]
    Q -->|"No"| I{"Forced by /search or selected by evidence routing, and Tavily configured?"}
    I -->|"Yes"| J["Fetch, sanitize, cache, and label Tavily results as untrusted evidence"]
    I -->|"No"| K{"Selected provider"}
    J --> K
    K -->|"OpenAI"| L["OpenAI Responses API"]
    K -->|"Ollama"| M["Ollama /api/chat"]
    L --> N
    M --> N
    N --> O["Neutralize Discord mentions and split response into chunks within Discord limits"]
    O --> P["Safe Discord reply or deferred-reply edit"]
```

For direct mentions, the Discord adapter first requires a bot mention, a guild context, an allowed channel, and the bot's channel permissions. Commands make their own guild, channel, allowlist, and input checks before calling the same conversation service. The service is the shared normalization boundary for both ingress paths: it replaces unverified Discord member IDs before persistence or provider use, and it owns event de-duplication and rate limiting for requests that reach it.

The local read-only Admin Command Deck consumes aggregate analytics through a
server-scoped API. Instrumentation events will use a common vocabulary such as
`command_started`, `command_succeeded`, `command_failed`,
`command_cancelled`, `delivery_succeeded`, `delivery_failed`,
`user_opted_in`, and `user_opted_out`. Events will carry only bounded metadata
such as feature, command, channel scope, result, duration, and Jarvis version.
They will never include secrets or full user messages. Discord commands remain
the fast operational surface; the Admin Command Deck is the visibility and
configuration surface.

Storage transitions for a guild plus conversation are coordinated and serialized. A clear operation advances that conversation's generation, so queued stale storage work is invalidated. The provider call runs outside those coordinated sections, so provider calls for the same conversation can overlap; the subsequent assistant-message append is checked against the generation before it persists.

`/faq` deliberately bypasses the conversational flow after the existing guild
and channel checks. An omitted topic lists approved questions; a registered
topic ID selects its answer from the active approved catalog chosen by
`FAQ_CATALOG_PATH`. Both are public replies through the existing safe-delivery
boundary, which may neutralize unsafe mention tokens before delivery. The
handler does not call the AI service, Tavily, or the conversation store, and it
does not modify the catalog.

## Optional poll flow

Polls are an opt-in path. `/poll` and `/poll-close` require a guild channel,
the existing allowlist, and an exact configured administrator ID. Creation
validates a two-to-five-option poll and one fixed duration, reserves durable
SQLite state, then edits the deferred interaction reply into a Jarvis-owned
poll message. Votes derive an HMAC voter token scoped to guild, poll, and
member, atomically update one aggregate selection, and never persist raw voter
IDs. This path does not call AI, Tavily, conversation history, moderation, or
server-administration code.

The poll store owns additive SQLite tables with parameterized statements, WAL,
foreign keys, and transactions. Closing deletes voter-token rows, disables
buttons, and preserves final totals. `PollScheduler` starts after Discord login,
never overlaps a tick, closes overdue polls, retries pending bot-message edits,
marks irrecoverable messages orphaned, and removes terminal rows after
`POLL_RETENTION_DAYS`.

## Personal reminders

`/reminder set`, `list`, and `cancel` use a dedicated store, service, gateway,
and non-overlapping scheduler. The service validates strict relative duration,
500-character text, opaque IDs, and 10 active reminders per guild and owner;
list and cancellation stay owner-scoped. Active reminders cancel idempotently,
while delivered and failed rows return no cancellable result.

`SQLiteReminderStore` owns additive `reminders` and
`reminder_schema_migrations` tables without changing `PRAGMA user_version`.
It uses parameterized statements, claims due rows with leases, recovers expired
claims, retries transient delivery around 1, 5, and 15 minutes, preserves
ambiguous send outcomes as `delivery_uncertain`, and removes terminal rows in
bounded seven-day cleanup. The gateway revalidates the live guild, channel, and
thread parent against the allowlist, then permits only the stored owner mention.
Logs contain only safe counts and categories, never reminder content or IDs.
Startup opens storage before login and starts the scheduler after handlers;
shutdown stops new work, awaits schedulers plus active command and periodic cleanup work, closes stores,
then destroys the Discord client.

## Web-grounding boundary

When `TAVILY_API_KEY` is configured, `/search` forces web grounding. Other
prompts are routed by `requiresWebGrounding()`, a deliberately small,
rule-based evidence heuristic. It selects current information; history and
origins; government programs, laws, and regulations; relationships between
named entities; dated statistics, prices, rankings, or quotations; medical,
legal, and financial claims; and evidence-dependent scientific claims.

The same router excludes basic timeless definitions, supplied-text summaries,
ordinary drafting or creative requests, and timeless coding help unless an
additional factual clause requires grounding. This boundary controls evidence,
cost, and latency. It is not an authorization decision or a guarantee that a
selected search will establish a fact.

Before generic freshness matching, the shared response-style classifier
recognizes a narrow set of casual greetings, thanks, jokes, and emotional
check-ins. Those prompts skip automatic grounding and receive an additional
trusted concise-casual instruction. Current factual subjects such as weather,
news, prices, laws, schedules, scores, releases, and patches remain standard
and eligible for automatic grounding. Explicit detail language also remains
standard. The provider generates the complete response; Jarvis does not apply
post-generation truncation.

The normalized prompt is Tavily's query. Tavily returns a bounded result set;
the service retains only nonempty summaries with HTTP(S) URLs, bounds title and
summary lengths, caches equivalent normalized queries in process memory, and
passes the sanitized evidence plus the current date to the selected AI provider.
Before the provider is called, a deterministic evidence gate rejects empty
results, named-entity relationship results that do not explicitly connect both
subjects, conflicting relationship evidence, and government claims without an
official `.gov` or `.mil` source. The provider is still instructed to prefer
primary sources, separate sourced facts from labelled inference, qualify gaps,
and avoid completion by guesswork.

After generation, the wrapper removes model-invented links and validates
evidence-sensitive output against the accepted result text. It withholds the
entire answer when the model introduces unsupported numbers, named entities,
quotations, laws, causal language, or too much novel factual vocabulary.
Successful grounded answers receive only the sanitized links for the evidence
that passed the gate. This deliberately favors a visible abstention over a
polished fabrication. It reduces hallucination risk but is not a general
semantic fact checker.

Known limitation: the rule-based exclusions can produce a narrow false negative
when an explicitly fictional compound prompt has a clearly separated real-world
factual follow-up that itself contains a fiction marker, such as `fictional
characters`. The current policy treats that marker as applying to the follow-up
and suppresses automatic search; `/search` remains the explicit override when
web evidence is wanted.

## Conversation identity and storage

Conversation isolation is by the pair `(guildId, conversationId)`. In a normal channel, `conversationId` is that channel's ID. In a thread, it is the thread ID, while the parent channel ID is retained only for allowlist and persona-mode inheritance. A parent ID on an allowlist permits its threads, but it does not merge their histories. `/forget` clears only the current guild and current channel-or-thread conversation.

`SQLiteConversationStore` owns the `conversation_messages` table. Each record contains `id`, `guild_id`, `conversation_id`, `user_id`, `role`, `content`, `created_at`, and an optional `openai_response_id`. The store reads recent records in chronological order, caps all stored rows after each append, and removes rows older than the configured retention cutoff. It uses SQLite WAL mode and a five-second busy timeout.

The replacement boundary is `ConversationStore`: `append`, `getRecent`, `clear`, `cleanup`, `healthCheck`, and `close`. A different durable store can implement that interface, but it must preserve the conversation service's guild-plus-conversation isolation and lifecycle expectations. Merely pointing a different database at the process is not an architecture, it is wishful plumbing.

## Trust boundaries

Discord message text, user names, interaction options, and Tavily search-result text are untrusted data. They are never trusted instructions. The persona file and FAQ catalog are operator-controlled startup inputs loaded separately from Discord content. `FAQ_CATALOG_PATH` comes only from the deployment environment; Discord can select a registered topic ID but cannot choose a path or edit catalog content. Catalog validation requires 1 to 25 strictly shaped entries before startup or command registration. A load failure reports only `Invalid FAQ catalog configuration: FAQ_CATALOG_PATH`, never the resolved path or catalog content. The local SQLite database and environment-derived credentials are host assets that operators must protect.

The selected provider is an external boundary:

- OpenAI receives the composed instructions, bounded history, prompt, and a derived safety identifier. The Responses request sets `store: false`.
- Ollama receives the composed instructions, bounded history, and prompt at the configured HTTP(S) endpoint.
- Tavily is optional. When web search is invoked, Tavily receives the user's full normalized prompt as its search query. Its bounded, sanitized summaries are evidence only; the grounding wrapper explicitly tells the AI not to treat them as instructions, and an empty usable result set carries an inability-to-verify instruction to the AI provider.

Jarvis has no implemented shell, code-execution, arbitrary-file, GitHub-write, Discord-administration, webhook-management, or autonomous-learning capability. The optional poll path creates and edits only Jarvis-owned poll messages; it cannot edit or delete other content, roles, channels, permissions, members, settings, or webhooks. Conversation history supplies request context only. It is not a training loop, and no request can grant the application new authority.

`classifyUnsupportedAction` returns local explanatory responses for obvious
requests that the current release cannot perform. It is deliberately a UX
classifier, not an authorization boundary. It cannot grant an action, validate
Discord authority, or replace permission and configuration checks.

## Extension seams

`AIService` is the provider seam: it accepts instructions, bounded history, prompt, a safety identifier, and an optional web-search flag, then returns text and an optional provider response ID. `WebSearchService` is the read-only search seam used by `WebGroundedAIService`. `ConversationStore` is the persistence seam. `src/extensions/contracts.ts` declares inert, disabled-by-default contracts with `enabled: false` and an `operator approval required` reason for future read-only GitHub, MCP, repository-context, pull-request-summary, recap, gaming-score, and image-description integrations, plus an inert administrator-authorization shape. They are declarations only, not working tools or capabilities, and the authorization shape cannot grant Discord permissions or server authority. No generic tool interface is wired into the application today. Any future tool adapter needs an explicit, least-privilege contract, operator authorization, untrusted-content handling, failure behavior, and tests before it becomes a capability.

See [Configuration](CONFIGURATION.md), [Discord setup](DISCORD_SETUP.md), and [Development](DEVELOPMENT.md) for operational details.
Stream notifications are an optional read-only extension. See [STREAM_NOTIFICATIONS.md](STREAM_NOTIFICATIONS.md) for its provider, idempotency, and delivery boundaries.
