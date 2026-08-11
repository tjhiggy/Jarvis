# Jarvis command surface matrix

This is the v0.7 Command Deck baseline. Discord remains the fast, contextual
surface for crew interactions. The local Command Deck is the safer home for
configuration, diagnostics, bulk administration, previews, and audit history.
Both surfaces share the same services and storage contracts.
External adapters follow the shared [provider contract](PROVIDER_CONTRACT.md)
and expose health without credentials or response content.

## Decision rules

| Surface      | Use it for                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Discord      | Quick member actions, current-channel context, public cards, buttons, and mobile-friendly responses.                                       |
| Command Deck | Configuration, feature flags, channel or role selection, schedules, provider controls, previews, bulk actions, health, metrics, and audit. |
| Both         | Operator actions that need an emergency Discord fallback while the richer workflow belongs in the Deck.                                    |

## Registered command inventory

| Discord command                                                                                             | Audience               | Risk / complexity                   | Recommended home                       | Migration and tracking                                                                                               |
| ----------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `/ask`, `/search`, `/faq`, `/help`                                                                          | Member                 | Read-only, quick                    | Discord                                | Keep. Track start, success, failure, latency, and provider outcome without content.                                  |
| `/forget`                                                                                                   | Member                 | Data deletion, quick                | Both                                   | Keep Discord for current-context deletion; Deck gets scoped deletion and audit visibility.                           |
| `/status`                                                                                                   | Member / operator      | Read-only, quick                    | Both                                   | Keep Discord summary; Deck owns detailed health and deployment identity.                                             |
| `/knowledge query`                                                                                          | Member                 | Read-only, bounded                  | Discord                                | Keep.                                                                                                                |
| `/server-search`                                                                                            | Member                 | Read-only, current channel/thread   | Discord                                | Keep. Search only already-retained Jarvis conversation data in the current context.                                  |
| `/my-stats status`, `enable`, `disable`                                                                     | Member                 | Private opt-in metrics              | Discord                                | Keep. Deck shows aggregate opt-in totals only, never member identity or command history.                             |
| `/image generate`                                                                                           | Administrator          | Paid external generation            | Discord                                | Keep disabled by default and restricted to one configured channel; Deck shows readiness only.                        |
| `/knowledge list`, `/knowledge approve`, `/knowledge revoke`                                                | Administrator          | Persistent approval mutation        | Command Deck primary, Discord fallback | Keep fallback with confirmation; Deck shows source status and audit.                                                 |
| `/feature-request preview`, `confirm`, `cancel`                                                             | Administrator          | Narrow GitHub issue creation        | Discord                                | Keep private preview and explicit confirmation; fixed repository and labels; no edit, close, PR, or merge authority. |
| `/catch-me-up`, `/channel-summary`                                                                          | Member / moderator     | Read-only, contextual               | Discord                                | Keep. Track aggregate usage only.                                                                                    |
| `/reminder set`, `/reminder list`, `/reminder cancel`                                                       | Member                 | Personal mutation, guided           | Discord                                | Keep mobile flow; Deck may expose personal delivery health, never private content.                                   |
| `/reminder shared-set`, `/reminder shared-list`, `/reminder shared-cancel`                                  | Administrator          | Public scheduled delivery           | Both                                   | Discord emergency fallback; Deck primary for channel selection, preview, audit, and bulk cancellation.               |
| `/fantasy standings`, `matchup`, `player`                                                                   | Member                 | Read-only provider lookup           | Discord                                | Keep. Deck shows provider health and league configuration, not player actions.                                       |
| `/introduce preview`, `confirm`, `cancel`; `/introduction view`, `edit`, `hide`, `show`, `delete`           | Member                 | Public card mutation                | Both                                   | Discord is primary; Deck provides moderation queue, retention, and deletion audit.                                   |
| `/suggest preview`, `confirm`, `cancel`, `delete`; `/suggestion acknowledge`, `defer`, `resolve`, `archive` | Member / administrator | Public card and moderation mutation | Both                                   | Discord remains fast; Deck is primary for moderation queue, bulk review, and audit.                                  |
| `/post preview`, `confirm`, `cancel`                                                                        | Administrator          | External delivery, guided           | Command Deck primary, Discord fallback | Deck provides channel selection, exact preview, nonce confirmation, audit, and retry.                                |
| `/event create`, `view`, `edit`, `cancel`; `/game-night create`, `list`; `/lfg`                             | Member / administrator | Guided public workflow              | Both                                   | Discord owns participation; Deck owns configuration, scheduling health, and bulk recovery.                           |
| `/recap preview`, `enable`, `pause`, `resume`                                                               | Administrator          | Scheduled public delivery           | Command Deck primary, Discord fallback | Deck owns schedule, preview, pause, audit, and delivery metrics.                                                     |
| `/trivia start`, `opt-in`, `opt-out`                                                                        | Member / administrator | Quick activity and preference       | Discord                                | Keep. Deck shows aggregate adoption and scheduler health only.                                                       |
| `/engagement status`, `pause`, `resume`, `delete`, `feature`                                                | Administrator          | Global control, deletion, flags     | Both                                   | Deck primary with confirmation and audit; retain Discord emergency controls.                                         |
| `/birthday set`, `show`, `delete`                                                                           | Member                 | Personal preference                 | Discord                                | Keep. Deck shows scheduler health and aggregate opt-in only.                                                         |
| `/profile create`, `view`, `edit`, `hide`, `show`, `delete`                                                 | Member / administrator | Personal profile mutation           | Both                                   | Discord owns member UX; Deck owns feature flag, deletion recovery, and aggregate health.                             |
| `/roles`                                                                                                    | Member                 | Allowlisted role toggle             | Discord                                | Keep mobile self-service; Deck configures allowlisted options and hierarchy diagnostics.                             |
| `/rss add`, `list`, `remove`, `pause`, `resume`                                                             | Administrator          | Feed config and external delivery   | Command Deck primary, Discord fallback | Deck owns host validation, destination, preview, pause, audit, and delivery metrics.                                 |
| `/notifications status`, `enable`, `disable`                                                                | Member                 | Personal preference                 | Discord                                | Keep. Deck shows aggregate opt-in and delivery health, never individual preference content.                          |
| `/config`                                                                                                   | Administrator          | Read-only diagnostics               | Both                                   | Keep concise Discord summary; Deck is the detailed source of truth.                                                  |

## Command Deck navigation

- **Overview:** version, database, providers, integrations, schedulers, and
  aggregate delivery metrics.
- **Community Intelligence:** approved-source totals, retained-search
  readiness, aggregate statistics opt-ins, image-generation readiness, and
  local model identity.
- **Community:** introductions, suggestions, events, trivia, profiles, roles,
  and member-safe moderation queues.
- **Broadcasts:** RSS, proactive posts, recaps, event reminders, trivia
  results, birthdays, and one-off broadcasts.
- **Settings:** feature flags, allowlisted channels and roles, schedules,
  retention, and provider configuration.
- **Operations:** audit events, migration status, backups, pause/resume, and
  safe recovery.

## QA and migration rules

Every migration keeps the Discord fallback, uses the shared service contract,
records content-free metrics, and ships with authorization, idempotency,
retention, mobile Discord, Deck API, and rollback tests. A command is not
removed from Discord until the replacement workflow is deployed, documented,
and smoke-tested in the configured test channel.
