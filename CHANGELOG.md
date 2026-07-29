# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Comprehensive project documentation, policy guidance, GitHub intake forms, and the `docs:check` validation gate.
- Local UX responses for clearly unsupported action requests, without treating classification as authorization.
- Interactive `/faq` browsing backed by a validated, checked-in catalog of approved Jarvis answers, with no AI, web-search, or conversation-storage call.

### Changed

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
