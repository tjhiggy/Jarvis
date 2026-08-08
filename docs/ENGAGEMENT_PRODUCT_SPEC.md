# Engagement Product Specification

## Status and decision

This document freezes the proposed engagement V1 contract. It is **planned,
not implemented**. Existing Jarvis commands and permissions remain unchanged
until the corresponding work is reviewed, merged, and released.

V1 is a small, privacy-aware loop for the Muthaship: a member can introduce
themselves, submit an idea, discover and RSVP to an event, read a recap, and
join one bounded activity. Jarvis may create and update only messages it owns
and may store only engagement records it owns in the local SQLite database.
It does not silently collect or summarize every channel's conversation.

## V1 member stories

| Member need | V1 outcome | Boundary |
| --- | --- | --- |
| Introduce myself | I can submit a short guided introduction, preview it, and post it only to the configured introduction channel. | I can cancel, opt out, or delete my own active introduction. |
| Submit a suggestion | I can submit a title and description, review a private confirmation, and publish a normalized suggestion card to the configured suggestion channel. | The card stays in Discord and SQLite; it does not create or edit a GitHub issue. |
| Browse and RSVP to an event | I can list configured events, read details, and choose yes, maybe, or no through a bounded bot-owned control. | RSVPs are event-scoped, capacity-aware, and never trigger role or server changes. |
| View a recap | I can read a concise recap of configured engagement activity for its stated source window. | It uses only configured engagement records and bot-owned activity, observes minimum-group thresholds, and says when data is incomplete. |
| Join one activity | I can opt into one lightweight activity, initially trivia unless the product owner explicitly selects community challenges. | The activity uses curated local content or an approved provider interface, has no XP, streak, economy, or public profile. |

## Scope, consent, and access

Engagement is disabled by default. An administrator must explicitly enable it
per guild and separately configure every destination or source channel. A
feature may read or post only in its configured channel set: introductions,
suggestions, events, recap, and activity. No configuration grants a blanket
license to scan general chat, threads, DMs, voice, or historical messages.

Only configured administrator roles may enable or pause engagement, configure
channels or retention, create, cancel, or manage events, or triage suggestions.
Members may create or delete only their own engagement data and may use RSVP or
activity controls only for themselves. Jarvis verifies guild, channel, user,
record ownership, expiry, and idempotency before a control changes state.

Each feature needs a visible opt-in before collecting a member's contribution.
An event RSVP is opt-in for that event, and reminders require an additional
event-reminder opt-in. A member can opt out at any time. Opt-out prevents new
engagement collection and reminders, removes the member from future activity
and recap participation counts where feasible, and exposes an owner-only
deletion path for retained engagement records. It does not delete other
members' records or rewrite a historical bot message; any retained historical
card must be removed or redacted through the owner deletion flow.

## Data, retention, and deletion

V1 stores only the minimum SQLite records required to operate the feature:
guild, configured channel, member identifier, feature record identifier,
status, timestamps, and the bounded member-supplied fields needed for the
published card or action. No raw channel-message archive, voice presence,
cross-server profile, or behavioral dossier is created. Logs must contain only
safe operational metadata, never contribution text or tokens.

Retention is administrator-configured within documented safe bounds and must
be enforced by scheduled cleanup. The initial product contract is:

| Record class | Retention rule |
| --- | --- |
| Introductions and suggestions | Retain active records for up to 90 days; owner deletion removes the SQLite record and the bot-owned card where possible. |
| Events and RSVPs | Retain until the event ends, then for up to 30 days for recovery and recap generation. |
| Activity participation and round results | Retain for up to 30 days; do not retain answer text beyond the active round. |
| Recap aggregates | Retain for up to 90 days; exclude personal text and suppress low-volume member-level detail. |
| Opt-out and deletion audit markers | Retain only long enough to enforce the request and prevent duplicate processing, up to 30 days. |

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

## Planned command surface

These commands are contract names for implementation and documentation checks,
not currently registered Discord commands:

- `/introduce`
- `/suggest`
- `/event create`
- `/event list`
- `/event details`
- `/event cancel`
- `/recap preview`
- `/trivia start`

Their eventual handlers must enforce the configuration, ownership, opt-in, and
deletion rules above; a command name is not permission to bypass them.

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

| Product contract area | Backlog issue | What the issue must preserve |
| --- | --- | --- |
| Suggestions | [#27](https://github.com/tjhiggy/Jarvis/issues/27) | Private confirmation, configured destination, bot-owned state, and no GitHub writes. |
| Events and RSVP | [#28](https://github.com/tjhiggy/Jarvis/issues/28) | Admin-only event setup, opt-in RSVP/reminders, capacity, and retention-limited records. |
| Guided introductions | [#30](https://github.com/tjhiggy/Jarvis/issues/30) | Preview, configured channel, member opt-out, and owner deletion. |
| Weekly recap | [#43](https://github.com/tjhiggy/Jarvis/issues/43) | Configured data only, privacy thresholds, source window, and incomplete-data notice. |
| Bounded first activity | [#16](https://github.com/tjhiggy/Jarvis/issues/16) | Curated trivia, opt-out, bounded participation, and no XP. |
| Alternative first activity | [#18](https://github.com/tjhiggy/Jarvis/issues/18) | Community challenges only if explicitly selected with the same privacy boundaries. |

## Acceptance gate

Before implementation starts, `npm run docs:check` must verify this document,
its required issue links, and the documented product commands. Before a feature
is called shipped, it must also have focused tests, an explicit configuration
and permission review, and an approved release. A Markdown table is not a
permission grant. Shocking, I know.
