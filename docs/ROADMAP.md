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

## Implemented, pending the next versioned release

- Privacy-aware engagement V1: configured guided introductions and suggestions,
  administrator-created events with opt-in RSVP, aggregate weekly recaps,
  curated trivia, retention-limited local SQLite records, member deletion and
  opt-out paths, and administrator scheduler pause/status controls.

Engagement V1 remains disabled by default and limited to configured channels,
bot-owned messages, and local SQLite records. See the
[Engagement runbook](ENGAGEMENT_RUNBOOK.md) for the operational contract. XP,
public profiles, voice tracking, automated role assignment, moderation,
Discord-setting changes, and external writes remain out of scope.

## Next

**Planned, not implemented.** Add a dedicated `SAFETY_IDENTIFIER_SECRET` so
safety-identifier derivation no longer depends on an existing provider or bot
credential. It requires configuration, migration guidance, tests, and review.

**Planned, not implemented.** Improve operator-ready backup and restore
automation only after it can preserve SQLite consistency, protect conversation
data, and require explicit human authorization.

**Planned, not implemented.** Add operational dashboards or metrics only with a
reviewed data-minimization design that excludes message content and secrets.

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
- GitHub writes, merge actions, issue changes, or pull-request changes by
  Jarvis.
- Unrestricted external-tool access, secret disclosure, or using untrusted
  content as instructions.

An item moves from planned to implemented after reviewed implementation,
validation, and documentation. It moves from implemented to released only with
an explicit release or tag. Roadmaps are navigation, not prophecy with better
typography.
