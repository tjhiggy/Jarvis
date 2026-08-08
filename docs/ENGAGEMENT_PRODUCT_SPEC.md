# Engagement Product Specification

## Operations and deletion

The product exposes an authorized, private `/engagement status` view with aggregate-only diagnostics. Administrators may pause or resume scheduled delivery per guild. Members can delete their own retained engagement records; configured administrators can perform the same guild-scoped deletion for a specified member. Audit events retain only guild ID, actor ID, operation, and timestamp.

## Status and decision

This document is the shipped engagement V1 product contract. Guided
introductions, suggestions, events and RSVP, weekly recaps, and curated trivia
are implemented behind explicit engagement configuration. They remain disabled
until configured and are not permission to expand Jarvis beyond this boundary.

V1 is a small, privacy-aware loop for the Muthaship: a member can introduce
themselves, submit an idea, discover and RSVP to an event, read a recap, and
join one bounded activity. Jarvis may create and update only messages it owns
and may store only engagement records it owns in the local SQLite database.
It does not silently collect or summarize every channel's conversation.

## V1 member stories

| Member need                 | V1 outcome                                                                                                                                          | Boundary                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Introduce myself            | I can submit a short guided introduction, preview it, and post it only to the configured introduction channel.                                      | I can cancel a preview or delete my own active introduction.                                                                            |
| Submit a suggestion         | I can submit a title and description, review a private confirmation, and publish a normalized suggestion card to the configured suggestion channel. | The card stays in Discord and SQLite; it does not create or edit a GitHub issue.                                                        |
| Browse and RSVP to an event | I can list configured events, read details, and choose yes, maybe, or no through a bounded bot-owned control.                                       | RSVPs are event-scoped, capacity-aware, and never trigger role or server changes.                                                       |
| View a recap                | I can read a concise recap of configured engagement activity for its stated source window.                                                          | It uses only configured engagement records and bot-owned activity, observes minimum-group thresholds, and says when data is incomplete. |
| Join one activity           | I can opt into one lightweight activity, initially trivia unless the product owner explicitly selects community challenges.                         | The activity uses curated local content or an approved provider interface, has no XP, streak, economy, or public profile.               |

## Scope, consent, and access

Engagement is disabled by default. An administrator must explicitly enable it
per guild and separately configure every destination or source channel. A
feature may read or post only in its configured channel set: introductions,
suggestions, events, recap, and activity. No configuration grants a blanket
license to scan general chat, threads, DMs, voice, or historical messages.

Configured administrator roles may pause engagement, create, cancel, or manage
events, and triage suggestions. Operators configure enablement, channels, and
retention through the deployment environment, not a Discord command. Members
may create or delete only their own engagement data and may use RSVP or activity
controls only for themselves. Jarvis verifies guild, channel, user, record
ownership, expiry, and idempotency before a control changes state.

Each feature needs a visible opt-in before collecting a member's contribution.
An event RSVP is opt-in for that event, and reminders require an additional
event-reminder opt-in. `/trivia opt-out` prevents future trivia participation
and deletes retained trivia participant rows; `/engagement delete` is the
owner-only path for all retained engagement data in the guild. Neither action
deletes other members' records or rewrites historical content Jarvis does not
own; a retained Jarvis card is removed through its owner deletion flow.

## Data, retention, and deletion

V1 stores only the minimum SQLite records required to operate the feature:
guild, configured channel, member identifier, feature record identifier,
status, timestamps, and the bounded member-supplied fields needed for the
published card or action. No raw channel-message archive, voice presence,
cross-server profile, or behavioral dossier is created. Logs must contain only
safe operational metadata, never contribution text or tokens.

Retention is administrator-configured within documented safe bounds and must
be enforced by scheduled cleanup. The initial product contract is:

| Record class                             | Retention rule                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Introductions and suggestions            | Retain according to `ENGAGEMENT_RETENTION_DAYS` (1 through 90 days); owner deletion removes the SQLite record and bot-owned card where possible. |
| Events and RSVPs                         | A completed or cancelled event older than `ENGAGEMENT_RETENTION_DAYS` is deleted with its RSVPs by SQLite cascade. Orphaned RSVP rows older than that cutoff are also removed. |
| Activity participation and round results | Retain according to `ENGAGEMENT_RETENTION_DAYS`; answer text is never stored.                                             |
| Recap preferences and run leases         | Recap preferences and completed or abandoned run leases older than `ENGAGEMENT_RETENTION_DAYS` are removed.                |
| Engagement preferences and audit markers | Guild pause preference and metadata-only pause/resume audit rows older than `ENGAGEMENT_RETENTION_DAYS` are removed.       |
| Opt-out and idempotency markers          | Opt-out and idempotency rows older than `ENGAGEMENT_RETENTION_DAYS` are removed.                                           |

The implementation must provide explicit owner deletion and authorized
administrator cleanup controls. Backups are operational copies of SQLite and
are governed by the existing backup and restore procedures; deletion from an
active database is not a magical retroactive eraser of an already-created
backup. Reality remains annoyingly physical.

## Response voice and safe behavior

Jarvis speaks in concise Muthaship voice: helpful, calm, lightly shipboard, and
plain about what it knows, what it cannot do, and what a member must do next.
It does not impersonate staff, claim moderation authority, pressure members to
participate, invent event details, or turn a recap into social surveillance.
Authoritative event, RSVP, and activity state comes from SQLite records, not
model prose. AI commentary is optional flavor and must be clearly separated
from the recorded state.

All member input is untrusted. Replies use safe formatting and bounded output;
mass mentions are disabled by default. Missing source data, unavailable
configured channels, expired controls, or unsafe inputs produce a concise safe
failure rather than a guess or an action outside the contract.

## Shipped command surface

The following commands are registered in the application command set. Their
availability still depends on the relevant engagement configuration, channel,
and role boundary:

- `/introduce`
- `/suggest`
- `/event create`
- `/event list`
- `/event details`
- `/event cancel`
- `/recap preview`
- `/trivia start`

Related shipped controls are `/introduction id`, `/suggestion delete`,
`/recap enable`, `/recap pause`, `/recap resume`, `/trivia opt-out`,
`/trivia opt-in`, and `/engagement status`, `pause`, `resume`, and `delete`.

Their handlers enforce the configuration, ownership, opt-in, and deletion
rules above; a command name is not permission to bypass them.

## Explicit non-goals

V1 excludes:

- XP, leaderboards, streaks, economy, and reputation scoring.
- Public member profiles or cross-channel and cross-guild profiling.
- Voice-state, voice-content, or passive activity tracking.
- Automated role assignment, role changes, or server-setting changes.
- Moderation actions, member discipline, or edits to content Jarvis does not own.
- Write-capable external integrations, including GitHub issue creation or updates.
- Silent collection from every Discord channel, DMs, threads, or historical archives.

## Traceability

| Product contract area      | Backlog issue                                      | What the issue must preserve                                                            |
| -------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Suggestions                | [#27](https://github.com/tjhiggy/Jarvis/issues/27) | Private confirmation, configured destination, bot-owned state, and no GitHub writes.    |
| Events and RSVP            | [#28](https://github.com/tjhiggy/Jarvis/issues/28) | Admin-only event setup, opt-in RSVP/reminders, capacity, and retention-limited records. |
| Guided introductions       | [#30](https://github.com/tjhiggy/Jarvis/issues/30) | Preview, configured channel, and owner deletion.                                        |
| Weekly recap               | [#43](https://github.com/tjhiggy/Jarvis/issues/43) | Configured data only, privacy thresholds, source window, and incomplete-data notice.    |
| Bounded first activity     | [#16](https://github.com/tjhiggy/Jarvis/issues/16) | Curated trivia, opt-out, bounded participation, and no XP.                              |
| Alternative first activity | [#18](https://github.com/tjhiggy/Jarvis/issues/18) | Community challenges only if explicitly selected with the same privacy boundaries.      |

## Acceptance gate

`npm run docs:check` verifies this document, its required issue links, and the
documented product commands. Continued changes require focused tests, an
explicit configuration and permission review, and an approved release. A
Markdown table is not a permission grant. Shocking, I know.
