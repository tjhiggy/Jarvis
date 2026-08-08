# Task 8 report: privacy-aware weekly community recap

## Delivered

- Added a weekly recap service that reads only guild-scoped engagement SQLite
  records and counts Jarvis-owned engagement cards. It never reads Discord
  channel history or includes member names or message text.
- Added a minimum group size of three for every published category. Low-volume
  weeks publish a quiet-week message instead of exposing individual behavior.
- Added persisted per-guild administrator opt-in, plus `/recap preview`,
  `/recap enable`, `/recap pause`, and `/recap resume`.
- Added a configured-channel weekly scheduler that uses a guild-scoped
  idempotency key, emits an explicit source window and incomplete-data note,
  and abstains when source data is unavailable.
- Wired clean scheduler shutdown and documented operations and security
  boundaries.

## Verification

- `npm test`: 46 files, 638 tests passed.
- `npm run build`: passed.
- `npm run docs:check`: passed.
- `git diff --check`: passed.
- Focused recap/privacy/scheduler/storage/registration suite: 25 tests passed.

## Known toolchain issue

`npm run lint` cannot run because the installed `typescript-eslint` rejects
the repository's TypeScript 7.0 version before ESLint evaluates project files.
This is an existing dependency compatibility mismatch, not a Task 8 lint
finding.
