# Platform Recovery Verification Design

## Purpose

Issue #279 requires repeatable proof that Jarvis can migrate, restart, recover,
and shut down safely without exposing private data. The proof must run against
disposable test state. Production Discord, provider, and SQLite data are never
inputs to this verification.

## Product outcome

An operator or release reviewer can run one command and receive a bounded,
content-free receipt covering the platform, storage, scheduler, provider, and
sanitization recovery scenarios required for v1.6. A committed matrix explains
which rows have executable evidence and which remain linked focused defects,
preventing silent coverage drift.

## Architecture

The recovery verifier has three layers:

1. A typed scenario catalog identifies every required recovery behavior, its
   executable Vitest evidence or linked focused defect, and its operator-facing
   recovery expectation.
2. A pure validator rejects missing, duplicate, unsafe, or nonexistent evidence
   and renders the canonical Markdown matrix.
3. A command-line runner executes the exact focused test files in a disposable
   environment and writes a local JSON receipt containing only scenario IDs,
   test-file names, aggregate outcomes split into verified and defect-linked
   scenarios, versions, duration, and a redaction assertion. Receipts are local
   evidence and are never committed.

The existing focused tests remain the source of runtime truth. This slice fills
only acceptance-criteria gaps discovered during reconciliation. Product defects
that require a separate behavior change are filed as focused v1.6 issues and
linked from the matrix rather than smuggled into a QA patch.

## Required scenario groups

- Fresh and legacy schema migration, reopen idempotence, backup, restore,
  restart, integrity check, and explicit rollback classification.
- Scheduler overlap, process-equivalent claim fencing, stale leases, pause
  races, retry or suppression release, and draining shutdown.
- Provider unavailable and recovered transitions with truthful, actionable,
  content-free state.
- Operational log, metric, Command Deck, and receipt sanitization.

## Evidence and privacy boundaries

- Test databases live under the operating-system temporary directory.
- Fixtures contain synthetic IDs and sentinel content only.
- No environment dump, Discord ID, member content, prompt, provider payload,
  raw URL, authorization header, or credential is written to a receipt.
- The receipt is written below `.artifacts/qa/`, which is git-ignored.
- A fixed canary secret is injected into raw receipt diagnostics, including
  nested count metadata. The real allowlist boundary sets the redaction result
  true only after the serialized safe receipt excludes that canary.
- The committed report is deterministic and contains no timestamps or machine
  paths.

## Release rules

- `npm run recovery:check` validates the catalog and committed matrix without
  changing files or using the network.
- `npm run recovery:write` regenerates the committed matrix.
- `npm run recovery:verify` runs the focused recovery suite and writes a local
  sanitized receipt.
- CI must run the check and focused verification on every pull request.
- Issue #279 closes only after merged-main verification evidence and the receipt
  summary are attached to the issue.
