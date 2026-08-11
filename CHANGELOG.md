# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.3.0] - 2026-08-10

### Added

- Platform Core contracts for module registration, interaction context,
  authorization, feature flags, storage, scheduling, delivery, audit, and
  aggregate command metrics.
- Local-first Command Deck health, provider readiness, RSS state, version
  identity, and content-free engagement metrics.
- Native GitHub Project automation and Discussion intake that keep backlog
  triage human-approved while synchronizing approved work to the delivery
  board.
- Phase 0 architecture, security, operations, release, and QA documentation.

### Operational notes

- This release does not grant Jarvis GitHub write or merge authority.
- The Command Deck remains local-first and read-only for this release.
- Run the deployment smoke checklist and database backup procedure before
  promoting the release to production.

## [0.2.0] - 2026-08-08

### Added

- Engagement V1 runtime and SQLite retention work for
  configured introductions, suggestions, events and RSVP, weekly recaps,
  curated trivia, member deletion and opt-out, scheduler health/pause controls,
  bounded cleanup of operational records, and the accompanying operator
  runbook, backup/restore, outage, and rollback documentation.
- Personal `/reminder set`, `/reminder list`, and `/reminder cancel` commands with owner-only delivery to the original allowed channel or thread, durable SQLite state, bounded retries, and seven-day terminal retention.
- Read-only Sleeper `/fantasy standings` with safe pre-draft handling and owner display-name resolution.
- Implemented: optional administrator-created anonymous polls with fixed
  durations, live aggregate totals, vote changes, local SQLite recovery,
  bounded expiry/synchronization maintenance, and `/poll-close`.
- Comprehensive project documentation, policy guidance, GitHub intake forms, and the `docs:check` validation gate.
- Local UX responses for clearly unsupported action requests, without treating classification as authorization.
- Interactive `/faq` browsing backed by a validated, checked-in catalog of approved Jarvis answers, with no AI, web-search, or conversation-storage call.

### Changed

- Added deterministic concise-casual routing for greetings, thanks, jokes, and
  emotional check-ins, preventing irrelevant automatic searches while
  preserving forced `/search` and detailed-answer behavior.
- Centralized Discord member-mention normalization in the conversation service so mention and slash-command requests share the same boundary.
- Reworked the Jarvis persona for a sharper, more concise MuthaShip voice with stronger anti-fabrication rules and an explicit verified-member-data boundary.
- Expanded automatic Tavily grounding from freshness-only prompts to a balanced policy for current and evidence-sensitive factual claims, while keeping basic definitions and ordinary drafting local.
- Grounded answers now prohibit relationship claims based only on co-occurrence or similarity and direct the model to admit when usable evidence cannot verify the requested facts.
- Added deterministic pre- and post-generation evidence gates that abstain on weak, conflicting, non-authoritative, or unsupported evidence-sensitive answers instead of trusting model compliance alone.
- Fixed the native Windows startup helper so repository paths containing spaces remain one quoted Node argument and duplicate-process checks recognize both Windows and portable separators.

## [0.1.0] - 2026-07-28

### Added

- Discord `/ask`, `/forget`, `/help`, `/search`, and `/status` commands, plus direct-mention responses.
- Short, isolated conversation history per Discord channel or thread.
- Ollama and OpenAI Responses API provider support.
- Optional Tavily grounding for questions that need current information.
- SQLite storage for bot-owned conversation records.
- Channel allowlisting, input limits, rate limiting, duplicate-event suppression, parameterized SQL, and safe response delivery controls.
- Docker deployment and native Node.js startup paths.
- Automated tests and project linting, formatting, and build commands.
- Jarvis Discord icon and banner assets.
