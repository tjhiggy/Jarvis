# Jarvis v0.5.0 Shipboard Broadcasts Design

## Status

Proposed for implementation. This design converts the approved v0.5 direction
into a release contract. It does not claim that the release is implemented or
deployed.

## Outcome

Jarvis v0.5.0 makes automated community posts predictable, useful, and easy to
stop. Administrators can configure and preview broadcast categories, enforce
quiet hours and cadence limits, inspect delivery health, and pause all future
posts without deleting configuration. Members control only notifications that
target them directly. Public channel posts remain public and are never described
as individually suppressible.

The release consolidates existing RSS, proactive post, recap, reminder, and
delivery behavior behind shared policy and observability contracts. It does not
rewrite the working modules or absorb the v0.6 Command Deck broadcast composer.

## Design principles

1. Public broadcasts and direct notifications are different products.
2. Every automated post has an explicit destination, source, schedule, and owner.
3. Preview must show the exact public payload without sending it.
4. Pause and kill-switch controls persist until an administrator explicitly
   changes them.
5. Delivery is idempotent, restart-safe, mention-safe, bounded, and observable.
6. Discord remains the immediate interaction surface. The local Command Deck is
   the visibility and configuration surface.
7. User-facing language uses MuthaShip, server, channel, and crew, never guild.

## Approaches considered

### A. Add preferences separately to every existing feature

This is the smallest initial patch, but it duplicates quiet hours, cadence,
pause, audit, and status behavior across RSS, proactive posts, recaps, and
reminders. The inconsistency would become permanent technical debt.

### B. Replace all notification modules with one new engine

This creates a theoretically tidy architecture at the cost of a dangerous
rewrite. Existing persistence, retry, and delivery behavior would all change at
once. That is too much blast radius for a community bot already in production.

### C. Add shared broadcast policy around existing modules

Recommended. Existing modules keep their domain logic and durable state. A
shared policy service answers whether a category may deliver now, while a shared
health projection reports outcomes consistently. Modules migrate incrementally
and retain their existing kill switches as compatibility controls.

## Scope

### 1. Broadcast categories

The shared vocabulary is:

- `rss`
- `proactive`
- `recap`
- `event_reminder`
- `birthday`

The first implementation slice establishes this typed catalog and preference
storage. RSS and proactive posts are the first public-broadcast adopters. Recaps,
event reminders, and birthdays migrate before the v0.5.0 release is tagged.

### 2. Administrator broadcast policy

Each server stores policy per category:

- enabled, paused, or disabled state
- allowlisted destination channel
- server timezone
- quiet-hours start and end
- minimum delivery interval
- optional digest mode where the module supports it
- update timestamp and safe actor metadata

Configuration precedence is environment safety boundary, then durable server
policy. The database cannot select a destination outside the environment-backed
channel allowlist. Existing feature-specific pause controls remain supported
during migration and must never override the global engagement pause.

### 3. Member notification preferences

Member preferences apply only to direct or personally targeted delivery:

- event reminders remain explicit opt-in
- future birthday or category mentions require explicit opt-in
- Jarvis sends no surprise direct messages in v0.5.0

Members cannot individually hide public RSS, recap, or proactive channel posts.
The UI explains this plainly instead of presenting a decorative toggle.

### 4. Shared policy service

`BroadcastPolicyService` is a small read-only decision boundary used immediately
before external delivery. It accepts server, category, destination, and current
time, and returns one of:

- allowed
- disabled
- paused
- globally paused
- outside destination allowlist
- quiet hours
- cadence limited
- member not opted in

The service does not send messages, fetch feeds, or mutate Discord. That keeps
policy independently testable and prevents provider logic from becoming an
authorization system by accident.

### 5. RSS delivery polish

RSS retains HTTPS host allowlisting, bounded parsing, and durable item dedupe.
v0.5.0 adds:

- exact preview before configuration changes
- per-cycle and per-day delivery limits
- optional digest cards rather than a wall of individual embeds
- source name, link, and publication time on every item
- claim, post, and completion state so a failed post is retryable
- safe failure health without feed content in logs

Newly added feeds establish a baseline and do not dump an entire historical feed
unless an administrator explicitly runs a preview.

### 6. Proactive engagement polish

Proactive content comes only from an administrator-approved local catalog. Each
entry has a stable ID, category, text, active state, and optional date window.
Jarvis selects only active entries and still applies quiet hours, cadence, pause,
destination, and idempotency rules. There is no AI-generated autonomous posting
in this release.

### 7. Operations and Command Deck

The Command Deck remains localhost-only and authenticated for write operations.
During v0.5.0 it gains visibility for:

- category state and destination label
- next eligible delivery window
- last attempt and last success
- safe error category
- recent aggregate delivery counts
- preview, pause, and resume controls

The one-off compose-and-send broadcast workflow stays in issue #177 and release
v0.6.0. v0.5.0 is about scheduled and source-driven delivery, not arbitrary
operator-authored announcements.

## Data model

New tables use composite server-scoped keys and parameterized queries:

### `broadcast_policies`

- `server_id`
- `category`
- `state`
- `channel_id`
- `timezone`
- `quiet_start_minute`
- `quiet_end_minute`
- `minimum_interval_seconds`
- `digest_mode`
- `updated_at`
- `updated_by_user_id`

Primary key: `(server_id, category)`.

### `broadcast_delivery_runs`

- `server_id`
- `category`
- `delivery_key`
- `status`
- `lease_token`
- `claimed_at`
- `completed_at`
- `error_category`

Primary key: `(server_id, category, delivery_key)`. Claims are leased and
token-fenced. Completion requires the current lease token.

### `member_notification_preferences`

- `server_id`
- `user_id`
- `category`
- `enabled`
- `updated_at`

Primary key: `(server_id, user_id, category)`. These rows never contain message
content, names, or profile data.

Durable preferences are not deleted by generic age-based cleanup. Delivery runs
and safe audit metadata use documented bounded retention.

## Interaction design

### Discord

Member-facing notification controls use one discoverable command group:
`/notifications status`, `/notifications enable category:<category>`, and
`/notifications disable category:<category>`. Responses are private and clearly
identify whether a category is a direct notification or a public channel
broadcast. Enable and disable reject public-only categories with an explanation
instead of saving a preference that cannot change what the member sees.

Administrator controls remain grouped under existing engagement and RSS command
surfaces until the command-surface audit in issue #198 is complete. No command
requires users to copy database IDs.

### Command Deck

Cards use the MuthaShip dark-space visual system, plain-language labels, and
status colors that do not rely on color alone. Every write follows:

1. edit or select
2. validate
3. preview exact effect
4. confirm
5. persist and audit
6. display truthful outcome and recovery action

Mobile layouts remain usable at 360 CSS pixels. Keyboard navigation, visible
focus, form labels, and accessible status text are release requirements.

## Error handling and safety

- Reject destinations outside configured channel boundaries.
- Disable uncontrolled mentions in every post.
- Reject mass and role mentions in administrator-authored catalog content.
- Never log feed bodies, prompt text, tokens, or message content.
- Project provider failures into bounded categories.
- Failed delivery does not claim success and remains safely retryable.
- Repeated failures apply bounded backoff instead of hammering Discord or a feed.
- Global pause is checked immediately before every external post.
- Scheduler shutdown waits for active work before SQLite closes.

## Metrics

The Command Deck reports aggregate, content-free events:

- delivery attempted, succeeded, failed, suppressed, and retried
- suppression reason by bounded category
- scheduler last run and health
- configured category count
- member direct-notification opt-in and opt-out counts

Metrics are server-scoped, retention-bounded, and contain no message bodies,
feed entries, names, or secrets.

## Release slices

1. **Policy foundation**: category catalog, durable policy and member preference
   storage, decision service, Discord preference UX, and audit events.
2. **RSS reliability**: baseline behavior, digest mode, delivery limits, durable
   retry state, previews, and health.
3. **Proactive catalog**: administrator-approved entries, policy integration,
   preview, and safe scheduling.
4. **Remaining adopters**: recaps, event reminders, and birthdays use the shared
   policy immediately before delivery.
5. **Operations and release QA**: Command Deck visibility, metrics, backup and
   migration rehearsal, desktop/mobile smoke tests, restart recovery, rollback,
   deployment, tag, release notes, and issue closure.

Each slice is independently reviewable and merged through a PR. The release is
not complete until all slices are deployed and verified together.

## Acceptance criteria

- An administrator can preview and pause every automated category.
- Public posts identify their source and never imply private delivery.
- A member can control every personally targeted notification category.
- No v0.5.0 path sends an unsolicited direct message.
- Quiet hours and cadence are enforced in the configured server timezone.
- A restart cannot duplicate a completed delivery.
- A failed post remains retryable and does not report success.
- Global pause prevents every outbound scheduled post.
- Command Deck health and metrics are truthful and content-free.
- Existing RSS, proactive, recap, reminder, and birthday behavior has regression
  coverage through migration.
- Full tests, build, lint, formatting, documentation, audit, migration rehearsal,
  backup, rollback, Discord smoke test, deployment verification, and tagged
  release all pass.

## Out of scope

- One-off Command Deck broadcast composition (#177, v0.6.0)
- Direct messages
- AI-generated autonomous announcements
- Arbitrary Discord channel discovery or server-setting changes
- Per-member suppression of public channel posts
- External purchases, monetization, or engagement economy mechanics
