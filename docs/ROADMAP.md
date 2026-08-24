# Roadmap

This roadmap separates current behavior from proposals. It contains no delivery
dates, promises, or claims that an interface declaration is a working feature.

## Shipped

- Single-process Node.js 22 Discord bot with outbound Gateway connectivity and
  no inbound web port.
- `/ask`, `/search`, `/forget`, `/faq`, `/help`, and `/status` commands plus
  direct mention handling in server channels.
- Personal reminders with owner-scoped delivery, read-only Sleeper standings
  and weekly matchups with resolved owner display names when available, and
  read-only GitHub repository, issue, and pull-request lookup.
- Channel allowlists, parent-thread handling, minimum reply permissions,
  per-guild/user rate limiting, event de-duplication, input bounds, and safe
  response delivery with mass mentions disabled.
- Local SQLite conversation storage, per-conversation history isolation,
  startup and daily retention cleanup, global stored-row cap, and `/forget`
  for the current conversation.
- OpenAI Responses and local Ollama providers with timeouts and bounded retries;
  optional Tavily web grounding with bounded results and in-memory caching.
- Optional administrator-created anonymous polls with fixed durations,
  two-to-five options, changeable anonymous selections, live aggregate totals,
  local SQLite recovery, and administrator early-close controls.
- Native Windows startup support and an optional hardened Docker Compose
  deployment with a persistent named SQLite volume.
- Deliberately inert extension contracts and documented operating boundaries.
- Privacy-aware engagement features including introductions, suggestions,
  events and RSVP, game nights, LFG signals, birthdays, trivia, recaps,
  allowlisted self-service roles, and bounded proactive post controls.
- Approved knowledge lookup with administrator-controlled per-server source
  approvals, `/catch-me-up`, and `/channel-summary` over retained Jarvis data.
- A localhost-authenticated Command Deck with safe health and delivery
  visibility, complete Discord/Deck command ownership decisions, and confirmed
  one-off broadcasts to friendly allowlisted destinations.
- Community Intelligence with ranked approved knowledge, private current-context
  retained search, opt-in private command totals, optional controlled image
  generation, a measured local-model decision, and aggregate Command Deck
  readiness visibility.

All implementation slices listed above are included in a tagged release. Features
remain independently gated and limited to configured channels, bot-owned
messages, and local SQLite records where applicable. See the
[Engagement runbook](ENGAGEMENT_RUNBOOK.md) for the operational contract.

## Release plan

The remaining backlog is organized into shippable GitHub milestones. Each issue
belongs to exactly one milestone, and each milestone requires tests,
documentation, migration rehearsal, Discord smoke testing, and a tagged release.

### v1.2.0 Expansion Systems

v1.2.0 shipped as the Expansion Systems release. It delivered bounded REST and
webhook boundaries, moderation policy foundations, tournament and voice policy
contracts, and GitHub Discussions-native intake. The milestone is closed.

### v1.3.0 Community Operations

Hardened Docker evaluation, private support tickets, server dashboard, activity
heatmap, year-in-review reporting, Command Deck operations, and release
configuration readiness.
Tracked issues: #5, #15, #41, #44, #57, #195, #228, #230, #232, #233, #234,
and #235.

### v1.4.0 Economy and Progression

Server currency, inventory, reward store, trading, achievements, XP, voice XP,
leaderboards, custom titles, and the staged migration of the Command Deck to an
optional Sites-hosted operator console.
Tracked issues: #8, #10, #11, #12, #13, #21, #23, #24, #25, and #263.
The Sites migration is deliberately staged: read-only mirror, authenticated
local API, confirmed safe writes, then production cutover with local fallback.
It was not completed in v1.4 and is tracked for v1.6 in issue #263.

### v1.5.0 Community Games and Entertainment

Daily/community challenges, predictions, tournament follow-ups, memorable
quotes, quote of the day, meme generation, roasts, and throwbacks.
Tracked issues: #17, #18, #19, #36, #37, #38, #39, and #40.

### v1.6.0 Sites Command Deck

v1.6.0 packages the Sites Command Deck migration: live snapshot presentation,
authenticated API, bounded Settings controls, localhost fallback, and cutover
verification. The operator still publishes the private Sites URL and completes
Discord/Command Deck smoke on the ship computer.

Issue #275, bounded private Sites Command Deck controls, is included in this
package. It remains disabled until tokens and origin allowlists are configured
and does not replace Discord fallback commands.

## Next

**Planned, not implemented.** Add a dedicated `SAFETY_IDENTIFIER_SECRET` so
safety-identifier derivation no longer depends on an existing provider or bot
credential. It requires configuration, migration guidance, tests, and review.

**Planned, not implemented.** Improve operator-ready backup and restore
automation only after it can preserve SQLite consistency, protect conversation
data, and require explicit human authorization.

**Planned, not implemented.** Add operational dashboards or metrics only with a
reviewed data-minimization design that excludes message content and secrets.

**Planned, not implemented.** Add a shared Command Analytics and Engagement
Metrics layer for the Admin Command Deck. It will record aggregate command,
delivery, scheduler, provider, adoption, participation, opt-in, opt-out, and
failure metrics without retaining raw message content. The design must define
server and channel scoping, retention, audit events, privacy controls, and
export-safe summaries before implementation.

**Shipped, bounded.** Sleeper integration supports one configured league's
read-only standings, weekly matchup results, and bounded player statistics via
`/fantasy player`. Transactions and additional fantasy features remain planned.

## Later

**Planned, not implemented.** Shared and administrator-created reminders; the
current reminder system is personal and owner-scoped.

**Planned, not implemented.** Recurring reminders.

**Planned, not implemented.** Exact date/time scheduling and per-user timezones.

**Planned, not implemented.** Reminder DM delivery with channel fallback.

**Planned, not implemented.** Account-wide reminder deletion and export.

**Planned, not implemented.** Introduce read-only integrations for approved
repositories, MCP context, pull-request summaries, recurring recaps, gaming
scores, and image-related assistance. Each must begin with explicit
authorization, least-privilege credentials, narrow data boundaries, failure
handling, tests, and content-free logs. See
[Extension guide](extensions/README.md).

**Planned, not implemented.** Evaluate a storage migration or worker model only
when a documented operational need exceeds the current single-process SQLite
design. No migration is implied by this roadmap.

## Explicitly out of scope

- Autonomous learning from Discord, repositories, provider responses, or
  operator activity.
- Arbitrary code execution, shell access, or arbitrary file access.
- Discord moderation, administration, role or channel changes, or mutation of
  content owned by others.
- GitHub writes, merge actions, issue mutation, or pull-request changes by
  Jarvis. Feedback and feature intake use native GitHub Discussions and issue
  forms.
- Unrestricted external-tool access, secret disclosure, or using untrusted
  content as instructions.

An item moves from planned to implemented after reviewed implementation,
validation, and documentation. It moves from implemented to released only with
an explicit release or tag. Roadmaps are navigation, not prophecy with better
typography.
