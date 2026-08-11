# Member Profiles Design

## Status

Approved for Jarvis v0.4.0 Crew Engagement planning on 2026-08-10.

## Purpose

Jarvis needs one privacy-safe member identity foundation before it can add
custom titles, profile cards, achievements, participation systems, or the
proposed MuthaShip Coins economy. Member profiles must help crew members find
shared interests without silently turning ordinary Discord activity into a
behavioral dossier.

This slice implements explicit, member-owned profiles. Jarvis creates no
profile until the member asks for one and confirms a private preview.

## Product decisions

- Profile creation is opt-in only.
- A profile is visible to other members of the same MuthaShip after creation.
- The owner may hide, show, edit, or permanently delete the profile.
- Jarvis resolves the current Discord display name, avatar, and server join
  date at view time instead of storing unnecessary copies.
- A retained introduction may suggest interests in a private draft, but Jarvis
  imports nothing until the owner confirms.
- Administrators do not receive a hidden-profile viewing override.
- Titles and achievements are future profile-card extensions. This slice
  defines their integration boundary but does not invent unlock state.

## Scope

### Included

- One profile per MuthaShip and Discord member.
- Optional bounded bio and interests.
- Visible or hidden profile state.
- Private create and edit previews with owner-bound Confirm and Cancel buttons.
- Public profile viewing in allowed server channels.
- Owner-controlled hide, show, and destructive deletion.
- Existing authorized, server-scoped administrative data deletion.
- SQLite persistence through a replaceable repository interface.
- Safe logging, rate limits, duplicate suppression, and operational metrics.
- Documentation, automated tests, and a manual desktop/mobile Discord smoke
  test.

### Excluded

- Automatic profile creation.
- Cross-server profiles or lookup.
- XP, levels, streaks, leaderboards, currency, inventory, or trading.
- Achievement or title earning rules.
- Message-history scanning or inferred interests.
- Discord nickname, role, permission, channel, or server-setting changes.
- Administrator access to hidden profile content.
- New privileged Discord gateway intents.

## Architecture

### Module boundary

Add a dedicated member-profile module rather than extending introductions.
Introductions are temporary engagement records with their own retention and
card lifecycle. Profiles are durable, explicitly managed identity records.
Combining them would create ambiguous consent and deletion behavior.

`MemberProfileService` owns validation, drafts, authorization, visibility, and
profile lifecycle. It depends on a replaceable `MemberProfileRepository` and a
small introduction-reader boundary used only to propose draft interests.

The SQLite adapter stores profile state in the existing Jarvis database using
parameterized queries and a migration. Discord identity data is supplied by the
handler at view time and is not written to the profile table.

### Core records

```ts
interface MemberProfile {
  serverId: string;
  userId: string;
  bio: string | null;
  interests: string | null;
  visibility: 'visible' | 'hidden';
  createdAt: string;
  updatedAt: string;
}

interface MemberProfileDraft {
  id: string;
  serverId: string;
  ownerUserId: string;
  operation: 'create' | 'edit';
  bio: string | null;
  interests: string | null;
  expiresAt: number;
}
```

The database key is `(server_id, user_id)`. The repository must expose
server-scoped create, read, update, visibility, delete, and administrative
owner-deletion operations. No query may use a user ID without the server ID.

Future titles and achievements integrate through read-only profile-card
enrichers. They receive server and user IDs and return display-safe data. The
base profile schema does not contain premature economy or achievement columns.

## Discord experience

### `/profile create bio:<optional> interests:<optional>`

Jarvis resolves the caller's current Discord identity and, when available, a
retained introduction. It creates a private in-memory draft and displays the
exact proposed profile. Suggested introduction interests are clearly labeled.
Nothing is saved until the owner presses Confirm. Cancel discards the draft.

### `/profile view member:<optional>`

Without `member`, Jarvis shows the caller's profile. With `member`, Jarvis shows
that member's visible profile in the current allowed server channel. Hidden and
nonexistent profiles share one neutral response so the command does not reveal
private state. A member may view their own hidden profile privately.

The card uses the current Discord display name and avatar, optional server join
date, bio, interests, and any future approved title or achievement enrichments.
Empty optional sections are omitted.

### `/profile edit bio:<optional> interests:<optional>`

Jarvis builds a private preview containing the complete resulting profile, not
just a partial diff. Confirm atomically replaces the editable values. Cancel or
expiry leaves the stored profile unchanged.

### `/profile hide` and `/profile show`

The owner changes visibility without deleting content. Hide takes effect
immediately. Show restores same-server profile discovery.

### `/profile delete`

Jarvis presents a private destructive confirmation. Confirm permanently removes
the stored profile and its profile-specific preferences. The response never
echoes deleted bio or interests. The existing `/engagement delete` path remains
available for the owner and authorized server administrators.

## Authorization and safety

- Commands require a server context and an allowed channel.
- Bots cannot create profiles.
- Only the owner may create, edit, hide, show, or directly delete a profile.
- Preview buttons bind to the draft, server, owner, bot-owned message, and
  expected operation.
- Drafts expire after 15 minutes, are memory-only, and are capped per owner.
- Repeated confirmation is idempotent and cannot create duplicate profiles.
- Bio and interests are trimmed, length-bounded, mention-neutralized, and
  rejected if they contain mass or role mentions.
- Output disables uncontrolled Discord mentions.
- Profile viewing never crosses server boundaries.
- Logs contain operation names, safe result codes, server ID, user ID, and
  correlation ID only. They never contain bio or interests.
- Profile commands emit aggregate command and lifecycle metrics without content.

## Persistence and lifecycle

Profiles persist until owner deletion or authorized server-scoped
administrative deletion. They do not use the short engagement-record retention
window because persistence is the feature's purpose.

Jarvis will not request the privileged Guild Members intent merely to detect
departures. If a member leaves, an authorized administrator may delete the
server-scoped record by user ID. A future reviewed cleanup mechanism may use a
bounded Discord lookup without expanding gateway authority.

Database writes are transactional where an operation spans multiple rows. A
failed create or edit leaves no partial state and does not claim success.
Deleting a profile removes profile-specific records atomically.

## Error handling

- Discord identity lookup failure returns a private temporary-unavailable
  response.
- Introduction lookup failure produces a blank draft rather than blocking
  creation.
- Database failure preserves the previous profile and reports no success.
- Duplicate create returns an actionable edit-or-delete response.
- Expired, replayed, foreign-owner, cross-server, and malformed controls are
  rejected safely.
- Hidden and missing profiles return the same public response.
- Unknown errors are projected to safe operational metadata before logging.

## Testing and release gates

### Automated tests

- Domain validation for empty, maximum, and excessive bio/interests values.
- Mention neutralization and mass-mention rejection.
- Bot rejection and owner authorization.
- Draft creation, introduction suggestion, expiry, cap, cancel, and replay.
- Atomic create and edit confirmation.
- Server isolation for every repository operation.
- Visible, hidden, owner-view, and neutral missing/hidden behavior.
- SQLite persistence across reopen, migration from an existing database, and
  concurrent create handling.
- Hide, show, direct deletion, and administrative owner deletion.
- Public versus private Discord responses and disabled mentions.
- Aggregate metrics without profile content.

### Repository gates

- Focused tests pass after each red-green cycle.
- The complete Vitest suite passes.
- TypeScript build passes.
- Documentation validation passes.
- Formatting and diff checks pass.
- Security review confirms no new privileged intent, cross-server leak, raw
  content logging, or uncontrolled Discord mutation.

### Manual Discord smoke test

1. Create a private draft using retained introduction interests.
2. Cancel and verify no profile exists.
3. Create again, confirm, and view the public card.
4. Edit and confirm the resulting full-profile preview.
5. Hide and verify another member receives the neutral unavailable response.
6. Verify the owner can inspect the hidden profile privately.
7. Show and view the profile publicly again.
8. Delete and verify the profile no longer appears.
9. Repeat key flows on desktop and mobile Discord.

## Rollout and rollback

The feature is protected by the per-server `profiles` feature flag and remains
disabled until the configured administrator enables it. Registering the command
does not create records. Rollback disables the flag and redeploys the previous
release; the migration is additive and profile data remains intact unless an
authorized deletion is explicitly requested.

This slice ships as a reviewed v0.4.x release increment only after pull-request
checks, deployment verification, the manual smoke test, updated release notes,
and a tagged GitHub Release.
