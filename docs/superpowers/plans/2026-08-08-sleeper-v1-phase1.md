# Sleeper V1 Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only Sleeper service foundation and a concise `/fantasy standings` command.

**Architecture:** Isolate Sleeper HTTP access behind a typed service interface. Keep league configuration in environment-backed config for one league per deployment, and keep Discord formatting separate from transport and data retrieval. No Sleeper write endpoints and no Discord setting changes.

**Tech Stack:** TypeScript, Node.js 22+, discord.js, native fetch, Vitest, Zod.

## Global Constraints

- Sleeper is authoritative for league facts.
- V1 is read-only.
- Never expose secrets or invent unavailable data.
- Keep Discord output concise and safe for message limits.

---

### Task 1: Sleeper client contract and standings retrieval

**Files:**
- Create: `src/sleeper/sleeper-types.ts`
- Create: `src/sleeper/sleeper-service.ts`
- Test: `tests/sleeper/sleeper-service.test.ts`

- [ ] Write failing tests for successful standings retrieval, malformed upstream data, and mapped outage errors.
- [ ] Run the focused test and confirm it fails because the service is missing.
- [ ] Implement a fetch-based client with timeout, response validation, and a replaceable `SleeperService` interface.
- [ ] Run the focused test and confirm it passes.

### Task 2: Configuration and command definition

**Files:**
- Modify: `src/config/config.ts`
- Modify: `src/commands/definitions.ts`
- Test: `tests/config/config.test.ts`
- Test: `tests/commands/definitions.test.ts`

- [ ] Add optional `SLEEPER_LEAGUE_ID` and validate its shape when provided.
- [ ] Add `/fantasy standings` as a read-only subcommand.
- [ ] Add tests for missing configuration and command registration.
- [ ] Run focused tests and then the full suite.

### Task 3: Handler integration and documentation

**Files:**
- Modify: `src/commands/handlers.ts`
- Modify: `src/index.ts`
- Modify: `.env.example`
- Modify: `README.md`
- Test: `tests/commands/handlers.test.ts`

- [ ] Add concise standings formatting with retrieval week/time and safe outage messaging.
- [ ] Wire the service through application dependencies without adding write access.
- [ ] Add mocked handler tests.
- [ ] Run tests, targeted lint, and build.

