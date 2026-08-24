# Command Deck Safe Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship previewed, authenticated, idempotent, auditable, and rollback-capable Command Deck controls for broadcast state, community feature flags, and RSS feeds.

**Architecture:** A framework-neutral mutation service owns the workflow state machine and delegates bounded reads/writes to runtime adapters. The local Jarvis HTTP server applies the existing Command Deck security boundary to versioned mutation endpoints, while the Sites client renders the contract without receiving secrets at build time.

**Tech Stack:** TypeScript, Node.js 22+, Vitest, SQLite-backed Jarvis services, React 19, vinext, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-23-command-deck-safe-controls-design.md`

## Global Constraints

- Local Jarvis remains authoritative.
- No secret editing, arbitrary environment editing, arbitrary channel lookup, role management, moderation, or server-setting changes.
- Every mutation requires preview and explicit confirmation.
- Duplicate confirmation cannot duplicate external effects.
- Audit records are metadata-only.
- Discord commands remain the fallback.

---

### Task 1: Mutation state machine

**Files:**

- Create: `src/admin/command-deck-mutations.ts`
- Create: `tests/command-deck-mutations.test.ts`

**Interfaces:**

- Consumes: a `CommandDeckMutationAdapter` that reads and applies one bounded action.
- Produces: `createCommandDeckMutationService()` with `preview`, `confirm`, `cancel`, and `rollback`.

- [ ] Write failing tests for exact diffs, stale previews, cancellation, idempotent confirmation, retryable failure, and rollback conflict.
- [ ] Run the focused suite and confirm each test fails for missing behavior.
- [ ] Implement the minimal state machine and bounded action validation.
- [ ] Run the focused suite and confirm it passes.

### Task 2: Authenticated mutation HTTP API

**Files:**

- Modify: `src/admin/admin-console.ts`
- Modify: `src/admin/command-deck-read-api.ts`
- Modify: `tests/admin-console.test.ts`
- Modify: `tests/command-deck-read-api.test.ts`

**Interfaces:**

- Consumes: the mutation service and existing request security policy.
- Produces: `/api/v1/command-deck/config/catalog`, `/preview`, `/confirm`, `/cancel`, and `/rollback`.

- [ ] Write failing API tests for authorization, origin, replay, body limits, allowlists, safe errors, and audit receipts.
- [ ] Run focused tests and confirm RED.
- [ ] Add shared request authorization and bounded JSON handlers.
- [ ] Run focused tests and confirm GREEN.

### Task 3: Runtime adapters

**Files:**

- Modify: `src/index.ts`
- Modify: `src/admin/admin-console.ts`
- Modify: `tests/application.test.ts`

**Interfaces:**

- Consumes: broadcast store, `FeatureFlagService`, `RssStorage`, configured feature list, channel allowlist, and RSS host allowlist.
- Produces: a catalog and mutation adapter scoped to the configured MuthaShip.

- [ ] Write failing integration tests for broadcast, feature, and RSS mutations plus compensating rollback.
- [ ] Run focused tests and confirm RED.
- [ ] Wire allowlisted adapters with metadata-only logging.
- [ ] Run focused tests and confirm GREEN.

### Task 4: Sites operator journey

**Files:**

- Modify: `sites/command-deck/app/page.tsx`
- Modify: `sites/command-deck/app/lib/command-deck.ts`
- Modify: `sites/command-deck/app/command-deck.test.tsx`
- Modify: `sites/command-deck/app/globals.css`

**Interfaces:**

- Consumes: the versioned catalog and mutation API.
- Produces: bounded controls with preview, confirm, cancel, retry, and rollback states.

- [ ] Write failing browser-component tests for each control family and every resilient state.
- [ ] Run the Sites suite and confirm RED.
- [ ] Implement accessible themed controls with exact diffs and honest outcomes.
- [ ] Run Sites tests, lint, and build and confirm GREEN.

### Task 5: Documentation, security, and release evidence

**Files:**

- Modify: `.env.example`
- Modify: `docs/ADMIN_CONSOLE.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/ROADMAP.md`
- Modify: `docs/TESTING.md`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes: the final runtime and Sites contracts.
- Produces: setup, operation, recovery, rollback, and smoke-test instructions.

- [ ] Document exact configuration, enabled-state proof, safe workflows, restart behavior, and rollback.
- [ ] Run full tests, lint, formatting, docs, feature matrix, both builds, and both dependency audits.
- [ ] Complete independent code and security review, resolve findings, and rerun gates.
- [ ] Open the PR, wait for CI, merge, close #275 with evidence, and update parent #263.
