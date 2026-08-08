# Task 5 report: guided introductions

Implemented `/introduce` and owner-only `/introduction id:<id>` handling.

- Bounded name (80), interests (300), and aboard text (500), private replies,
  disabled mass mentions, configured-channel-only delivery, opt-out checks,
  active-duplicate prevention, and per-guild/member rate limiting.
- SQLite persists the bot-owned message ID, supports deletion of the card and
  record status, and recovers active-duplicate protection after restart.
- Added focused introduction and storage coverage for missing channel, opt-out,
  deletion authorization, limits, and restart recovery.
- Suggestions, events, recaps, and activity remain untouched.

Verification: focused tests, full test suite, TypeScript build, formatting,
documentation check, and whitespace diff check were run after implementation.
The repository-wide ESLint command remains blocked by the pre-existing
typescript-eslint incompatibility with TypeScript 7.0.

## Review follow-up

Preview drafts are transient and private. Only `/introduce confirm` persists
and posts a card; `/introduce cancel` discards the draft. A partial SQLite
unique index atomically permits one active introduction per guild/member,
including concurrent confirmation attempts. Startup and daily retention cleanup
delete expired bot-owned cards before removing their records, retaining a record
when Discord deletion fails so the bounded cleanup can retry. The follow-up
coverage includes preview/cancel, concurrent confirmation, and card-safe
retention cleanup.

## Re-review follow-up

Failed Discord-card deletion now transitions an expired introduction to
`cleanup_pending`; generic repository cleanup deletes only already-deleted
introduction rows and cannot erase the retry record. Startup cleanup runs only
after Discord login, so configured channel operations have a ready client.
Migration safely retains the newest duplicate legacy active introduction and
marks earlier duplicates `cleanup_pending` for later bot-card removal. The
concurrent-confirmation regression now uses SQLite rather than an in-memory
stand-in.
