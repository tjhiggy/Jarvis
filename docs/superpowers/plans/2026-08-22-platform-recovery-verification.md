# Platform Recovery Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship reproducible, privacy-safe evidence for Jarvis platform, storage, scheduler, and provider recovery behavior required by issue #279.

**Architecture:** A typed recovery-scenario catalog is reconciled against real test files and rendered as a committed matrix. A focused runner executes those tests and writes a local sanitized JSON receipt, while CI and documentation checks prevent scenario or report drift.

**Tech Stack:** TypeScript, Node.js 22, Vitest, SQLite, npm scripts, GitHub Actions, Markdown

**Spec:** `docs/superpowers/specs/2026-08-22-platform-recovery-verification-design.md`

## Global Constraints

- Verification never reads production `.env`, Discord state, provider credentials, or production SQLite data.
- Runtime fixtures use temporary paths and synthetic values only.
- Receipts contain scenario IDs, test files, aggregate outcomes, versions, duration, and redaction status only.
- The committed matrix is deterministic and contains no timestamps or machine paths.
- Product defects outside this verifier are fixed with regression tests or filed as focused v1.6 issues.

---

### Task 1: Recovery scenario domain and canonical matrix

**Files:**

- Create: `src/platform/recovery-verification.ts`
- Create: `src/platform/recovery-scenario-catalog.ts`
- Create: `tests/recovery-verification.test.ts`
- Create: `tests/recovery-scenario-catalog.test.ts`
- Create: `docs/PLATFORM_RECOVERY_VERIFICATION.md`

**Interfaces:**

- Produces: `RecoveryScenario`, `validateRecoveryScenarios`, `renderRecoveryMatrix`, and `recoveryScenarioCatalog`
- Each scenario includes `id`, `group`, `claim`, `evidence`, `recovery`, and optional `defect`

- [ ] **Step 1: Write failing validator tests**

  Assert rejection of duplicate IDs, missing groups, missing or unsafe evidence paths, evidence outside `tests/**/*.test.ts`, blank recovery guidance, and canary/private-data strings.

- [ ] **Step 2: Run focused tests and verify RED**

  Run `npm test -- tests/recovery-verification.test.ts` and confirm the module is missing.

- [ ] **Step 3: Implement pure validation and deterministic rendering**

  Add the strict types, repository-contained evidence checks, required-group reconciliation, and Markdown renderer. No network or runtime state is allowed.

- [ ] **Step 4: Write the real-catalog reconciliation test and verify RED**

  Assert all required groups and issue #279 acceptance claims are covered, evidence files exist, and the committed report exactly matches generated output.

- [ ] **Step 5: Populate the catalog and generate the matrix**

  Reconcile existing storage, application, scheduler, provider, logging, metrics, and admin-console tests. Link focused defects for claims that are not yet truthful.

- [ ] **Step 6: Run focused tests and commit**

  Run both new tests, generate the matrix, rerun them, and commit the independently reviewable catalog slice.

### Task 2: Sanitized focused verification runner

**Files:**

- Create: `src/platform/recovery-receipt.ts`
- Create: `scripts/verify-platform-recovery.ts`
- Create: `tests/recovery-receipt.test.ts`
- Modify: `.gitignore`
- Modify: `package.json`

**Interfaces:**

- Consumes: `recoveryScenarioCatalog`
- Produces: `RecoveryReceipt`, `sanitizeRecoveryReceipt`, `npm run recovery:check`, `npm run recovery:write`, and `npm run recovery:verify`

- [ ] **Step 1: Write failing receipt tests**

  Feed a canary token, raw IDs, credentialed URLs, headers, prompts, multiline errors, and nested failure details into the receipt boundary. Assert that only allowlisted aggregate fields survive.

- [ ] **Step 2: Run the focused receipt test and verify RED**

  Run `npm test -- tests/recovery-receipt.test.ts` and confirm the receipt module is missing.

- [ ] **Step 3: Implement the allowlist-only receipt model**

  Permit repository version, Node version, scenario IDs, repository-relative test files, counts, duration, exit status, and a boolean redaction result. Reject arbitrary metadata.

- [ ] **Step 4: Implement the focused runner**

  Spawn Vitest with the unique catalog evidence files, capture only exit status and aggregate summary, create `.artifacts/qa/platform-recovery.json`, and exit nonzero on test failure or unsafe output.

- [ ] **Step 5: Verify focused execution and commit**

  Run receipt tests and `npm run recovery:verify`; inspect the receipt for machine paths, content, IDs, URLs, and secrets before committing the runner slice.

### Task 3: Acceptance-gap regressions and defect routing

**Files:**

- Modify: focused files under `tests/`
- Modify: production files only when a failing regression proves a bounded defect
- Modify: `src/platform/recovery-scenario-catalog.ts`
- Modify: `docs/PLATFORM_RECOVERY_VERIFICATION.md`

**Interfaces:**

- Consumes: the catalog gaps from Task 1 and runtime result from Task 2
- Produces: executable coverage or a linked focused v1.6 defect for every issue #279 claim

- [ ] **Step 1: Reconcile every acceptance criterion**

  Map fresh and legacy migrations, backup and restore, restart, rollback classification, scheduler overlap and leases, pause races, retries, shutdown, provider transitions, and sanitization to exact tests.

- [ ] **Step 2: Add each missing regression test first and verify RED**

  Keep each behavior in its owning suite. A missing product capability must fail for the expected reason before production code changes.

- [ ] **Step 3: Apply minimal fixes or file focused defects**

  Fix bounded defects in scope. File broader provider, migration, or scheduler redesigns as v1.6 issues and record their numbers in the scenario catalog.

- [ ] **Step 4: Regenerate and run the complete focused verification**

  Run `npm run recovery:write`, `npm run recovery:check`, and `npm run recovery:verify`. The matrix must contain no uncovered or unlinked claim.

- [ ] **Step 5: Commit the gap-closure slice**

  Include only tests, bounded fixes, catalog updates, and generated matrix changes.

### Task 4: CI, operator documentation, and issue closure

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/validate-docs.ps1`
- Modify: `README.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `docs/IMPLEMENTATION_STATUS.md`

**Interfaces:**

- Consumes: all recovery scripts and the canonical matrix
- Produces: required CI gates, documented operator commands, and merged-main closure evidence

- [ ] **Step 1: Add recovery verification to CI and documentation validation**

  Run the read-only matrix check and focused recovery suite before the general test suite. Require canonical links from README and implementation status.

- [ ] **Step 2: Document contributor and operator use**

  Explain check, write, and verify modes, receipt location, privacy boundary, and how focused defects remain visible.

- [ ] **Step 3: Run every repository gate**

  Run recovery check and verify, feature check, full tests, build, lint, formatting, and documentation validation.

- [ ] **Step 4: Perform independent review**

  Review for unsupported recovery claims, missing scenarios, test-only assertions that cannot fail, secret exposure, unrelated changes, and platform-specific path defects.

- [ ] **Step 5: Publish and close**

  Push the branch, create a PR closing #279, wait for required checks, merge it, rerun all gates on merged `main`, attach the sanitized receipt summary to #279 and #272, and remove the remote feature branch.
