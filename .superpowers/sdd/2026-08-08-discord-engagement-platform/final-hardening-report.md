# Engagement V1 final hardening report

## Status

Final lifecycle hardening is implemented and locally verified. Engagement V1
remains unreleased. No deployment, production command registration, database
migration, push, pull request, tag, or release was performed.

## Safety fixes

- Retention no longer expires member opt-outs, recap enablement, or guild pause
  preferences. A pause survives cleanup and restart until explicit resume.
- Introduction deletion and suggestion owner/retention deletion persist
  `cleanup_pending` before Discord deletion and remove content only after the
  bot-owned card is gone.
- `/engagement delete` stages card deletions in the version 19 SQLite migration.
  Failed Discord deletions remain durable across restart; known Discord
  “unknown message” responses are treated as already compensated.
- RSVP writes atomically close events at their configured end, or at their
  start when no end exists. Late racing clicks are rejected and scheduler ticks
  close due events after reminder processing so retention can collect them.
- Weekly recap run identity uses the configured timezone, local scheduled date,
  and local slot, avoiding UTC-midnight and daylight-saving collisions.
- Trivia per-round failures are content-free logged, mark last-run health as an
  error, and apply a one-minute durable retry delay. User disclosure now uses
  `ENGAGEMENT_RETENTION_DAYS` instead of a hard-coded 30 days.
- Graceful shutdown stops new work and schedulers, drains active Discord command
  and periodic cleanup promises, then closes engagement SQLite.

## Verification

- `npm test`: passed, 53 files and 677 tests.
- `npm run build`: passed.
- `npm run docs:check`: passed, 55 tracked files, 45 environment keys, and 10
  package scripts.
- `git diff --check`: passed.
- Targeted Prettier check for all changed TypeScript and test files: passed.
- Targeted ESLint attempt: blocked before source inspection because installed
  `typescript-eslint` rejects the locked TypeScript 7.0 runtime under ESLint
  10.8.0.

## Remaining release blockers

1. Resolve the TypeScript 7.0 and `typescript-eslint` compatibility mismatch,
   then run lint successfully.
2. Exercise all engagement commands and interactions in a disposable,
   non-sensitive Discord guild.
3. Obtain explicit operator authorization, stop the single production process,
   and back up SQLite before applying migration 19.
4. After an authorized deployment, monitor one full scheduled cycle and retain
   rollback evidence.

These are release stop conditions. “The unit tests passed” is not a production
change-management strategy, despite the software industry's recurring attempts
to cosplay it as one.
