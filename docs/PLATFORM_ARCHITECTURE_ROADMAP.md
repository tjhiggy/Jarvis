# Jarvis Community Platform Architecture Roadmap

This is the canonical plan for evolving Jarvis from a capable Discord bot into
the MuthaShip community platform. It is a release plan, not a promise that a
feature is already implemented. Every item moves from planned to implemented
only after code, tests, and documentation are complete. It moves to released
only after a tagged release and deployment verification.

## Product direction

Jarvis has two layers:

1. **Core platform**: Discord routing, permissions, feature flags, storage,
   migrations, scheduling, safe delivery, provider boundaries, audit, health,
   analytics, and the Admin Command Deck API.
2. **Community modules**: introductions, suggestions, events, trivia, polls,
   reminders, birthdays, LFG, game nights, RSS, proactive posts, recaps,
   approved knowledge, Sleeper Fantasy Football, and future integrations.

Modules must use shared contracts and remain independently enableable,
permission-scoped, testable, and removable. Existing behavior is migrated
incrementally. There is no risky platform rewrite.

## Release phases

Phase 0 was released as `v0.3.0` on 2026-08-10. The shipped slices define the shared
interaction, authorization, module, health, analytics, and audit contracts,
the module registry and instrumentation boundary, durable aggregate metrics,
provider and integration readiness, and a localhost-only read-only Command
Deck. Existing Discord command behavior remains unchanged.

| Release | Focus | Shippable outcome |
| --- | --- | --- |
| 0.3 | Platform Core | Released. Module registry, interaction context, authorization, feature flags, storage and scheduler contracts, health, audit, and command analytics events. |
| 0.3.x | Discord Interaction Shell | Consistent help, concise responses, private/public indicators, preview-confirm-cancel flows, buttons instead of UUID copy and paste, and standard error states. |
| 0.4 | Crew Engagement | Shared UX and contracts across introductions, suggestions, events, RSVP, trivia, polls, reminders, birthdays, LFG, and game nights. |
| 0.5 | Shipboard Broadcasts | RSS, proactive posts, recaps, reminders, quiet hours, cadence limits, preferences, previews, pause/resume, kill switches, and durable deduplication. |
| 0.6 | Command Deck | Local Admin Console with safe channel selection, configuration previews, audit visibility, backup and rollback support, mobile polish, and authenticated, confirmed writes. |
| 0.7 | Community Intelligence | Privacy-bounded recaps, approved knowledge, summaries, catch-me-up, and aggregate insights with source windows and minimum-group thresholds. |
| 0.8 | Connected Systems | Read-only Sleeper Fantasy Football, GitHub, MCP, repository questions, and pull-request summaries with strict allowlists. |
| 1.0 | MuthaShip Platform | Versioned module SDK, compatibility tests, security review, backup and restore rehearsal, rollback runbooks, and operational readiness. |

## Command analytics and engagement metrics

The Admin Command Deck must measure the platform without becoming a
surveillance system. Instrumentation records aggregate, server-scoped events:

- `command_started`, `command_succeeded`, `command_failed`, and
  `command_cancelled`
- `delivery_succeeded` and `delivery_failed`
- Scheduler health and provider readiness
- Feature adoption and participation
- Opt-in and opt-out rates
- Response duration and bounded error categories

Metrics never include secrets or full message content. The implementation must
define retention, deletion, channel and server scope, audit metadata, and
export-safe summaries before dashboards are enabled.

## UI and UX requirements

UI/UX is a platform capability, not a final polish pass.

- Discord is the fast interaction surface.
- The Admin Command Deck is the visibility and configuration surface.
- Use server, channel, crew, and MuthaShip in user-facing copy.
- Prefer buttons, menus, and previews over internal ID entry.
- Make public versus private behavior obvious.
- Keep routine responses to one screen where possible.
- Provide accessible labels, high contrast, mobile-safe layouts, and recovery
  actions for errors.
- Require confirmation for destructive or externally visible changes.
- Never expose credentials, raw private content, or uncontrolled mentions.

## Hosting and trust boundaries

The local Jarvis process remains the source of truth. Local components include
Node.js, SQLite, Ollama, schedulers, and local configuration. Cloud services
include Discord and optional OpenAI, RSS providers, Sleeper, GitHub, MCP, and
the Sites frontend. Sites must not contain secrets or directly expose an
unrestricted control surface. The first Admin Command Deck release is
read-only and local-first; safe writes require an authenticated API boundary.

## Definition of done for every phase

Each phase requires:

- A reviewed implementation PR and tagged release
- Unit, integration, and regression tests
- Build and documentation checks
- Migration and rollback notes
- Security and privacy review
- A smoke-test script and Discord demonstration
- Deployment verification
- Updated roadmap, architecture, README, and operator documentation
- Explicit feature flags and safe defaults

## Out of scope

Jarvis will not autonomously learn from raw Discord conversations, execute
code or shell commands, modify server settings, perform GitHub writes, expose
secrets, or grant arbitrary role permissions.

