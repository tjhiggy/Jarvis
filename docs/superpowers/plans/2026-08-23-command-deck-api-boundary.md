# Command Deck Authenticated Read API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the authenticated, read-only local API that supplies safe operational projections to the private Sites Command Deck.

**Architecture:** A focused projection module converts the existing local `AdminConsoleSnapshot` into a versioned, secret-free contract. A stateful request boundary enforces a dedicated token, loopback-or-allowlisted origin policy, timestamp freshness, UUID replay prevention, and fixed-window rate limits before the existing HTTP server serves the projection. Configuration and runtime wiring remain local by default and document the private Sites tunnel as the only approved remote model.

**Tech Stack:** TypeScript, Node.js HTTP and crypto modules, Zod configuration, Vitest, private OpenAI Sites tunnel.

**Spec:** `docs/superpowers/specs/2026-08-23-command-deck-api-boundary-design.md`

## Global Constraints

- The endpoint is read-only and versioned as `1.0`.
- Use a dedicated read token, never the existing mutation token.
- Default binding remains `127.0.0.1`; remote access requires an approved private Sites tunnel.
- No secrets, raw configuration, Discord IDs, member identity, message content, prompts, provider payloads, image content, or unrestricted database records may cross the boundary.
- Existing localhost dashboard and `/api/status` remain functional.
- All new behavior follows test-first red-green cycles.

---

### Task 1: Safe versioned projection

**Files:**
- Create: `src/admin/command-deck-read-api.ts`
- Create: `tests/command-deck-read-api.test.ts`

**Interfaces:**
- Consumes: `AdminConsoleSnapshot` from `src/admin/admin-console.ts`.
- Produces: `CommandDeckReadSnapshot`, `projectCommandDeckReadSnapshot(snapshot, observedAt)`.

- [ ] **Step 1: Write failing projection tests** for schema version, observation timestamp, freshness, release identity, health, provider posture, integration state, scheduler summaries, feature flags, aggregate metrics, and audit readiness. Add canary fields containing tokens, IDs, content, credentialed URLs, and query strings and assert none serialize.
- [ ] **Step 2: Run `npx vitest run tests/command-deck-read-api.test.ts`** and confirm failure because the module does not exist.
- [ ] **Step 3: Implement the minimal typed projection** with explicit unions and bounded arrays/numbers. Map unknown runtime evidence to `unknown` or `configured`, never `healthy`.
- [ ] **Step 4: Rerun the focused test** and confirm it passes.
- [ ] **Step 5: Commit** with `feat: add safe Command Deck read projection`.

### Task 2: Authentication, replay, origin, and rate policy

**Files:**
- Modify: `src/admin/command-deck-read-api.ts`
- Modify: `tests/command-deck-read-api.test.ts`

**Interfaces:**
- Produces: `CommandDeckReadPolicy`, `CommandDeckReadAuditEvent`, and `createCommandDeckReadBoundary(policy)` with `authorize(request, now)` and expiring in-memory request state.

- [ ] **Step 1: Write failing table-driven tests** for valid loopback and allowed-origin requests plus missing bearer token, wrong token, malformed UUID, invalid timestamp, expired timestamp, future timestamp, replay, disallowed origin, absent remote origin, and fixed-window rate limit.
- [ ] **Step 2: Run the focused test** and confirm the missing boundary failures.
- [ ] **Step 3: Implement constant-time token comparison**, exact origin matching, UUID validation, clock window validation, replay retention, fixed-window limits, and metadata-only audit outcomes.
- [ ] **Step 4: Rerun the focused test** and confirm it passes without timers, network, or production state.
- [ ] **Step 5: Commit** with `feat: secure Command Deck read requests`.

### Task 3: HTTP endpoint and local fallback

**Files:**
- Modify: `src/admin/admin-console.ts`
- Modify: `tests/admin-console.test.ts`

**Interfaces:**
- Extends `startAdminConsole` with optional `readApi` policy and audit dependencies.
- Serves `GET /api/v1/command-deck/snapshot` only after boundary authorization.

- [ ] **Step 1: Write failing HTTP tests** for a successful authenticated response and every safe error status: 400 malformed, 401 unauthorized/expired/replayed, 403 origin, 405 method, and 429 rate limit. Assert security headers, no-store, schema metadata, and zero canary leakage.
- [ ] **Step 2: Run `npx vitest run tests/admin-console.test.ts tests/command-deck-read-api.test.ts`** and confirm the endpoint tests fail with 404.
- [ ] **Step 3: Add the endpoint before existing route fallback**, reject bodies/methods, call the read boundary, project a fresh snapshot, and emit audit metadata without headers, addresses, tokens, or payloads.
- [ ] **Step 4: Verify focused tests pass** and the existing `/`, assets, `/api/status`, and write tests remain green.
- [ ] **Step 5: Commit** with `feat: expose authenticated Command Deck snapshot`.

### Task 4: Configuration and runtime wiring

**Files:**
- Modify: `src/config/config.ts`
- Modify: `src/index.ts`
- Modify: `.env.example`
- Modify: `tests/config.test.ts`
- Modify: `tests/application.test.ts`

**Interfaces:**
- Adds `COMMAND_DECK_API_TOKEN`, `COMMAND_DECK_API_ALLOWED_ORIGINS`, `COMMAND_DECK_API_RATE_LIMIT`, `COMMAND_DECK_API_WINDOW_SECONDS`, and `COMMAND_DECK_API_MAX_CLOCK_SKEW_SECONDS`.

- [ ] **Step 1: Write failing configuration tests** for defaults, HTTPS origin normalization, invalid origins, weak/missing token while enabled, invalid bounds, and secret separation from `ADMIN_CONSOLE_TOKEN`.
- [ ] **Step 2: Run focused config/application tests** and confirm the new config is absent.
- [ ] **Step 3: Add Zod validation and frozen configuration**, wire the policy and safe logger audit in `src/index.ts`, and keep the API disabled when the dedicated token is empty.
- [ ] **Step 4: Rerun focused tests** and confirm runtime startup and shutdown remain deterministic.
- [ ] **Step 5: Commit** with `feat: configure Command Deck read boundary`.

### Task 5: Operations documentation and disposable exercise

**Files:**
- Modify: `docs/SITES_COMMAND_DECK.md`
- Modify: `docs/CONFIGURATION.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/IMPLEMENTATION_STATUS.md`
- Modify: `README.md`
- Create: `scripts/verify-command-deck-read-api.ts`
- Create: `tests/command-deck-read-api-smoke.test.ts`
- Modify: `package.json`

**Interfaces:**
- Adds `npm run command-deck-api:verify`, which starts a disposable loopback console, exercises valid and denied requests, checks safe receipts, and never reads production configuration.

- [ ] **Step 1: Write a failing smoke test** requiring a sanitized JSON receipt for success, malformed, unauthorized, expired, replayed, cross-origin, and rate-limited requests.
- [ ] **Step 2: Run the smoke test** and confirm failure because the verifier is missing.
- [ ] **Step 3: Implement the disposable verifier and documentation** covering token generation/rotation, private tunnel setup, Sites server-side secret usage, troubleshooting, stale/offline behavior, rollback, and local fallback.
- [ ] **Step 4: Run focused smoke tests and `npm run command-deck-api:verify`** and inspect the receipt for content and secret canaries.
- [ ] **Step 5: Commit** with `docs: add Command Deck API operations guide`.

### Task 6: Release gate, review, PR, and issue closure

**Files:**
- Review all files changed from `origin/main`.

**Interfaces:**
- Produces PR and closure evidence for issue #276; updates parent #263.

- [ ] **Step 1: Run full verification:** `npm test`, `npm run build`, `npm run lint`, `npm run format:check`, `npm run docs:check`, `npm audit --audit-level=high`, `npm run command-deck-api:verify`, and `git diff --check`.
- [ ] **Step 2: Run a scoped security review** of the authentication, origin, replay, rate-limit, projection, and logging diff.
- [ ] **Step 3: Request independent code review** against this plan and fix every Critical or Important finding with a failing regression test first.
- [ ] **Step 4: Push, create the PR, wait for CI, merge, delete the feature branch, and verify `main` contains the merge.**
- [ ] **Step 5: Exercise the endpoint against a disposable Jarvis runtime**, attach sanitized receipts to #276, close #276, and update #263 with the next dependency (#275).

