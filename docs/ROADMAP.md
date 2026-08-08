# Roadmap

This roadmap separates current behavior from proposals. It contains no delivery
dates, promises, or claims that an interface declaration is a working feature.

## Shipped

- Single-process Node.js 22 Discord bot with outbound Gateway connectivity and
  no inbound web port.
- `/ask`, `/search`, `/forget`, `/faq`, `/help`, and `/status` commands plus
  direct mention handling in server channels.
- Personal reminders with owner-scoped delivery, and read-only Sleeper
  standings with resolved owner display names when available.
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

## Next

**Planned, not implemented.** Add a dedicated `SAFETY_IDENTIFIER_SECRET` so
safety-identifier derivation no longer depends on an existing provider or bot
credential. It requires configuration, migration guidance, tests, and review.

**Planned, not implemented.** Improve operator-ready backup and restore
automation only after it can preserve SQLite consistency, protect conversation
data, and require explicit human authorization.

**Planned, not implemented.** Add operational dashboards or metrics only with a
reviewed data-minimization design that excludes message content and secrets.

**Shipped, bounded.** Sleeper integration currently supports one configured
league's read-only standings. Matchups, weekly recaps, player lookup, and
additional fantasy features remain planned under [Issue #95](https://github.com/tjhiggy/Jarvis/issues/95).

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
- GitHub writes, merge actions, issue changes, or pull-request changes by
  Jarvis.
- Unrestricted external-tool access, secret disclosure, or using untrusted
  content as instructions.

An item moves from planned to shipped only after reviewed implementation,
validation, documentation, and an explicit release. Roadmaps are navigation,
not prophecy with better typography.
