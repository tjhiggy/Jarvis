# Jarvis implementation status

This matrix is the source of truth for milestone claims. A feature is only
**shipped** when its runtime path, tests, documentation, configuration, and
deployment evidence exist. A contract, projection, or foundation is not a
shipped user feature.

The executable [shipped-feature verification matrix](SHIPPED_FEATURE_VERIFICATION.md)
owns the command-by-command inventory, configuration requirements, automated
evidence, and manual smoke cases. Run `npm run features:check` before changing a
shipped claim.

## Current status

| Area                              | Status                    | What is actually available                                                                                                         | What remains                                                                              |
| --------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Discord runtime and core platform | Shipped                   | Commands, permissions, SQLite, migrations, schedulers, safe delivery, feature flags, audit, and release gates                      | Continue incremental hardening                                                            |
| Local Command Deck                | Shipped                   | Local operator dashboard at `http://127.0.0.1:8787` with health, configuration visibility, metrics, previews, and bounded controls | Sites migration is not complete                                                           |
| Sites-hosted Command Deck         | Planned                   | Architecture and staged migration contract only                                                                                    | Read-only mirror, authenticated API, safe writes, cutover, and rollback evidence          |
| Crew engagement                   | Shipped in bounded slices | Introductions, suggestions, events, trivia, birthdays, LFG, game nights, reminders, roles, profiles, and proactive controls        | Additional UX and automation remain separately scoped                                     |
| Shipboard broadcasts              | Shipped in bounded slices | RSS, proactive posts, recaps, event reminders, birthdays, and trivia result delivery with policy and lease controls                | Additional provider and content adapters remain optional                                  |
| Community Intelligence            | Shipped in bounded slices | Approved knowledge, retained-context summaries, private stats, image-generation foundation, and measured local-model routing       | Broader intelligence automation is not enabled                                            |
| Connected Systems                 | Shipped in bounded slices | Read-only Sleeper, GitHub, and provider contracts; GitHub intake is Discussions-native                                             | Additional adapters and richer workflows require separate releases                        |
| Economy and progression           | Foundation only           | Server-scoped contracts, bounded ledger/progression storage, and aggregate projections                                             | Complete rewards, inventory, trading, XP, leaderboards, titles, and user-facing workflows |
| Community games and entertainment | Foundation only           | Validated allowlisted catalog and safety boundaries                                                                                | Delivery adapters, moderation workflow, scheduling, and opt-in experiences                |
| Support tickets                   | Foundation only           | Privacy-safe service and repository boundary                                                                                       | Discord channel/thread adapter and operator workflow                                      |
| Docker deployment                 | Evaluated                 | Hardened deployment guidance and rehearsal evidence                                                                                | Adopt as the primary production path only after operator decision and migration evidence  |

## Required configuration versus implementation

Configuration can enable a shipped feature, but it cannot turn a foundation into
a complete product. Every release checklist must distinguish:

- **Implemented:** runtime behavior exists and is tested.
- **Configured:** the operator has supplied the required channel, role, provider,
  or secret values.
- **Enabled:** the feature flag or runtime switch is on.
- **Released:** a tagged build contains the implementation.
- **Verified:** the deployed process has passed the smoke test.

## Known incomplete work

The following are intentionally not claimed as shipped:

1. Sites migration of the Command Deck.
2. Complete economy and progression workflows beyond the bounded foundation.
3. Complete entertainment workflows beyond the catalog foundation.
4. Discord support-ticket delivery and moderation workflow.
5. Additional reminder modes such as recurring, shared, DM fallback, and export.
6. Optional future provider adapters and worker/storage scaling.

Each item must receive its own issue, milestone, acceptance criteria, release
notes, configuration contract, migration/rollback plan, and deployment smoke
test before its status changes.

## Release rule

Milestone closure must link the implementation PR, release tag, test/build/docs
evidence, migration rehearsal, deployment verification, and any deferred
follow-up issues. If one of those is missing, the item stays foundation-only or
planned.
