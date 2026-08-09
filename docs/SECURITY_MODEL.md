# Security Model

Jarvis is a proprietary advisory bot. It is not a moderator, administrator,
automation agent, or general-purpose execution environment. The controls below
describe implemented source behavior; proposals are labelled as planned.

## Protected assets

- Discord bot token, OpenAI API key, and Tavily API key.
- Discord application, guild, channel, and user identifiers.
- Bot-owned SQLite conversation history, including prompts and successful
  assistant responses, plus backups of that database.
- Trusted operator configuration and persona content.
- Approved FAQ catalog content and topic-to-answer integrity.
- Optional poll administrator IDs, poll questions/options, aggregate totals,
  and the secret-derived voter-token boundary.
- Optional engagement channel IDs, administrator role IDs, retention and
  participation limits, and the bot-owned engagement records they govern.
- Provider account availability, budget, rate limits, and model access.
- Optional Sleeper league identifier, public roster/display-name data, and the
  integrity of the read-only fantasy standings boundary.
- The integrity of Jarvis's deployment, source revision, and command set.

The application does not encrypt SQLite data itself. Protect the host, Docker
volume, native database directory, and backups accordingly.

## Trust boundaries

Discord gateway events, slash-command text, mentions, and search results are
untrusted input. They cannot select configuration or persona paths, grant
authority, or replace system instructions. The trusted persona is loaded from
an operator-configured local file at startup and is bounded to 8,000 Unicode
characters. Configuration comes from the deployment environment, not Discord.

OpenAI, Ollama, and Tavily sit beyond the process boundary. Sending a prompt to
the configured provider shares it with that provider. When web grounding runs,
the full normalized user prompt leaves the process as Tavily's search query.
Tavily results are bounded, sanitized, untrusted evidence, not instructions.
Docker administrators can inspect container environment values, so a production
deployment should use the platform's approved secret-management boundary.

The FAQ catalog is another trusted, operator-controlled local input.
`FAQ_CATALOG_PATH` is read from the deployment environment, never from Discord.
Startup and command registration validate 1 to 25 strictly shaped entries;
Discord users can only select registered topic IDs. Missing, unreadable, or
invalid content fails closed with a sanitized error that names
`FAQ_CATALOG_PATH` without exposing an absolute path or catalog content.

## Implemented controls

- **Channel access.** `ALLOWED_CHANNEL_IDS` gates `/ask`, `/search`,
  `/forget`, and mention handling; an allowlisted parent permits its threads.
  Empty means every otherwise accessible server channel, so explicit production
  allowlists are recommended.
- **Discord permission checks.** Mention replies require View Channel, Read
  Message History, and Send Messages, or Send Messages in Threads for threads.
  The client requests only Guilds and Guild Messages gateway intents.
- **Input and concurrency bounds.** Prompts have a configured character limit,
  history and stored rows are bounded, duplicate events are suppressed, and
  rate limits apply per guild and user.
- **Shared prompt normalization.** The conversation service replaces raw
  Discord member-mention IDs before prompts from either mentions or slash
  commands are stored or sent to a provider.
- **Unsupported-action responses.** An explicit classifier answers obvious
  requests for unavailable actions locally. This is a UX guardrail, not
  authorization or permission enforcement; supported-action classification
  would not grant Jarvis any capability.
- **Data separation.** History is isolated by guild and channel or thread.
  `/forget` removes only Jarvis-owned history for the current conversation;
  retention cleanup removes old bot-owned rows.
- **Provider safeguards.** Both adapters use configured timeouts and bounded
  retries. OpenAI requests set `store: false`; provider errors map to generic
  user-facing failures.
- **Web-grounding safeguards.** Automatic routing is a heuristic for evidence,
  provider usage, and latency. It is neither authorization nor proof that a
  selected result is true. Search-result text cannot change instructions. A
  deterministic pre-generation gate rejects empty or inadequate relationship
  evidence, conflicting relationship sources, and government claims without an
  official source. A post-generation gate withholds evidence-sensitive answers
  that introduce unsupported objective claims or insufficiently grounded
  factual vocabulary. These controls deliberately fail closed, but lexical
  validation is not full semantic entailment and cannot eliminate every
  hallucination.
- **Mass-mention protection.** Replies set Discord `allowedMentions` to an
  empty parse list with `repliedUser: false`, and text is neutralized before
  delivery. Jarvis cannot turn an answer into an `@everyone` incident.
- **Approved FAQ boundary.** `/faq` selects content from the active approved
  catalog configured by `FAQ_CATALOG_PATH`; `config/faq.json` is only the
  default. The catalog is immutable in process and read-only to Discord.
  Replies pass through mention-neutralizing safe delivery, so unsafe mention
  tokens may be transformed. Listing or selecting a topic makes no AI, Tavily,
  or conversation-storage call; it only sends the requested public reply.
- **Credential redaction.** Structured logs recursively redact values under
  keys named `token`, `apiKey`, or `authorization` (case-insensitive), including
  those keys in nested headers. This is not a general secret detector for
  differently named fields. Error projection keeps safe class/category/code
  metadata rather than error messages, stacks, content, or secret values.
- **Database safety.** SQLite uses parameterized statements, WAL mode,
  foreign-key enforcement, and a five-second busy timeout.
- **Anonymous poll boundary.** `/poll` and `/poll-close` require an exact
  configured administrator ID after the existing guild and channel checks.
  Members can vote or change one selection while a poll is open, but storage
  receives only an HMAC-derived token scoped to guild, poll, and member. It
  never stores raw voter IDs. Closure deletes individual vote-token rows and
  preserves only final aggregate totals for the configured retention period.
- **Poll-message authority.** Jarvis creates and edits only its own poll
  messages. It does not delete messages or gain authority over roles, channels,
  permissions, members, moderation, server settings, or webhooks. Poll text is
  untrusted content and does not enter poll telemetry.
- **Engagement configuration boundary.** Engagement is off unless
  `ENGAGEMENT_ENABLED=true`; startup rejects enablement without at least one
  configured engagement channel and administrator role. Each configured channel
  is a separate scope for its future feature, not permission to read guild chat
  generally. The recap scheduler additionally requires an enabled recap channel
  and a strict weekday/time plus valid IANA timezone. Retention, per-user, and
  participant limits are bounded at startup so an operator cannot quietly turn
  a social feature into an endless data hoover.
- **Engagement message authority.** Future engagement handlers may send embeds
  and bot-owned buttons only in explicitly configured channels after normal
  Discord channel permission checks. Buttons confer no role, moderation, or
  server-setting authority. The bot requests no additional privileged intent,
  and it must not read arbitrary channel history for a recap or activity.
- **Weekly recap privacy boundary.** Recaps are opt-in per guild and publish
  only aggregate counts from configured engagement SQLite records and
  Jarvis-owned posts. They never read historical channel content, names, or
  individual activity. Every category requires a minimum group of three; small
  cohorts are replaced with a quiet-week message. Recaps state their seven-day
  source window and that data may be incomplete, and abstain if that source is
  unavailable.
- **Personal reminder boundary.** `/reminder` is owner-scoped, ephemeral at
  command time, and delivers only to the original allowed channel or thread
  after live revalidation. Its public payload permits only the verified owner
  mention; reminder text cannot activate mass, member, role, or channel
  mentions. There is no DM, recurring, exact-time, timezone, administrator
  override, webhook, or external delivery path. SQLite reminder statements are
  parameterized; lease and uncertain-delivery state prevent unsafe replay, and
  logs exclude reminder content and Discord identities.
- **Sleeper boundary.** `SLEEPER_LEAGUE_ID` selects one public league and does
  not act as a credential. The integration reads rosters and user display
  names only, treats pre-draft unassigned owners as normal, and fails closed
  on unavailable or malformed data. It has no code path for lineup changes,
  waiver claims, trades, roster changes, commissioner actions, league settings,
  or Discord settings.

## Safety identifier

For OpenAI requests, the service hashes the supplied safety identifier before
sending it. Current application wiring derives the identifier from the OpenAI
key when it is present, otherwise the Discord token, then hashes it with guild
and user identifiers before the provider adapter hashes the final value again.
No raw credential is intentionally placed in the outbound safety-identifier
field.

**Planned hardening, not implemented:** add a dedicated
`SAFETY_IDENTIFIER_SECRET` configuration value, keep it in the secret manager,
and use it solely for identifier derivation. This needs a reviewed code,
configuration, example-file, and test change. It must not be claimed as a
current setting.

## Prohibited capabilities and administration policy

This release has no enabled capability or implemented execution path for
arbitrary shell or code execution, arbitrary file access, Discord server
administration, deleting or editing other members' content, GitHub writes,
external tool invocation, or autonomous learning. Disabled extension contracts,
including the read-only MCP context contract, exist as declarations only; they
do not implement tools or grant authority. The persona cannot grant those
powers.

The unsupported-action classifier improves clarity and avoids wasting provider
calls on obvious requests Jarvis cannot perform. It must never be treated as a
security boundary or allowlist. Implemented adapters, credentials, Discord
permissions, configuration, and operator approval define actual authority.

Jarvis makes ordinary delivery edits to its own deferred interaction reply and,
when configured, creates or edits its own poll messages. An operator-run
command-registration script bulk-overwrites this application's guild command
definitions. Neither is general server administration. All
administrative changes must be deliberate, operator-authorized, scoped to the
named system, and non-destructive by default. Do not turn a support request into
an unreviewed change to Discord, source control, or production data.

## Implemented, unreleased engagement controls

Engagement stores only local, guild-scoped records needed to operate its cards,
events, recaps, and trivia. Member data collection is explicit through a
submission, RSVP, or activity answer; it does not scan channel history, DMs,
voice, or general member behavior. Stored fields, deletion paths, retention,
scheduler leases, and recovery are specified in the
[Engagement runbook](ENGAGEMENT_RUNBOOK.md). `/engagement delete` removes one
member's retained guild records, and `/trivia opt-out` removes retained trivia
participation and blocks future activity until opt-in.

Engagement controls and scheduled work create, edit, or remove only
Jarvis-owned messages and SQLite rows. Pause, status, recap, event, suggestion,
and trivia controls do not grant server-setting, role, moderation, webhook,
or external-write authority. Backup copies remain protected historical data
until their approved retention period expires.

## External-service risks

OpenAI and Tavily may be unavailable, rate limited, or incur charges. Model
availability and billing are provider-controlled. Local Ollama trades external
API exposure for local host, disk, CPU/GPU, and network exposure risks. Search
content and model output can be inaccurate or adversarial. Treat all generated
guidance as advisory, validate important claims independently, and do not let
retrieved content become an instruction channel.
