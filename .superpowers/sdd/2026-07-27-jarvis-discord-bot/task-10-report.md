# Task 10 report: composition root, logger, contracts, registration, and shutdown

## Status

Complete, including fix round 1.

## Delivered

- Added type-only, disabled extension contracts. They expose no runtime tool
  registry, shell, filesystem, execution, Discord-admin, or GitHub-write path.
- Added structured Pino logging that redacts credential-shaped fields and
  authorization headers at arbitrary nesting depth.
- Added `createApplication` with injected clients, storage, timers, signal
  registration, and exit-code seams. Shutdown is idempotent, gates new event
  work before cleanup, clears the retention timer, closes SQLite, and destroys
  Discord exactly once.
- Added safe startup failure cleanup and nonzero exit-code handling.
- Added development-guild-only slash-command registration using Discord API v10
  and `Routes.applicationGuildCommands`; global registration is absent.

## Original TDD evidence

- RED: `npm test -- tests/logger.test.ts tests/application.test.ts` failed as
  expected because `src/utils/logger.ts` and `src/index.ts` did not exist.
- GREEN: `npm test -- tests/logger.test.ts tests/application.test.ts` passed,
  with 3 tests covering credential redaction, shutdown idempotency, event
  gating after shutdown, and failed-startup cleanup.

## Original verification

- `npm test`: passed, 26 files and 236 tests.
- `npm run lint`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.

## Original commit

`c2c86ad feat: compose Jarvis runtime safely`

## Fix round 1

### Defects corrected

- Retention cleanup was only scheduled, so stale records could survive until
  the next 24-hour interval. Startup now awaits one safe cleanup before the
  application accepts work, then schedules future cleanup.
- Listeners were attached only after Discord login, creating an event-routing
  gap. Listeners now bind before login and remain gated until the bot user,
  handlers, startup cleanup, and signal registration are ready.
- Native `Error` instances lost their non-enumerable identity in the logger.
  Errors now project only a safe `name`, `class`, and bounded `code`; message,
  stack, content, and secret values never enter the log object.

### Fix-round TDD evidence

- RED: `npm test -- tests/logger.test.ts tests/application.test.ts` failed
  with a zero startup-cleanup count, missing pre-login listeners, and an error
  projection missing `name` and `class`.
- GREEN: `npm test -- tests/logger.test.ts tests/application.test.ts` passed,
  with 5 tests. The new cases prove immediate cleanup, pre-login binding with
  post-ready enablement, and safe nested `Error` projection.

### Fix-round verification

- `npm test`: passed, 26 files and 240 tests.
- `npm run lint`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.

### Self-review

- Confirmed `ConversationService` remains the sole event-deduplication owner.
- Confirmed the trusted persona loader receives only the validated configured
  persona path, never Discord content.
- Confirmed neither the extension contracts nor runtime composition introduces
  tools, server administration, shell, filesystem execution, or GitHub writes.
- Confirmed the registration script uses only the development-guild route.
- Confirmed logger error projection deliberately omits message and stack, even
  when those fields contain credentials.

## Fix-round commits

The implementation and this required report are committed separately so the
report can cite the immutable implementation commit exactly.

- `7b123e5 fix: harden startup lifecycle and logging`
- `docs: add Task 10 implementation report` (this report commit)
