# v0.9 Crew Engagement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Ship v0.9 as independently releasable, opt-in community engagement modules with privacy-safe identity, rewards, participation, teams, game roles, and aggregate Command Deck visibility.

**Architecture:** Extend existing server-scoped SQLite repositories, feature flags, scheduler leases, safe Discord cards, and aggregate analytics. Each module has explicit opt-in, bounded retention, deletion/opt-out behavior, and no arbitrary server administration. Deliver one tagged release per completed slice rather than one risky cutover.

**Tech Stack:** TypeScript, Node.js 22+, discord.js, SQLite, Vitest, Prettier, ESLint, GitHub Actions, local Command Deck.

## Global Constraints

- Use MuthaShip terminology in user-facing copy; never expose internal `guild` terminology.
- All state is server-scoped and parameterized; no cross-server reads.
- Default features off unless explicitly enabled by an administrator.
- No cash value, gambling, pay-to-win moderation, external purchases, or arbitrary role/server mutations.
- All public posts disable uncontrolled mentions; private previews use explicit confirmation.
- Every mutation has idempotency, bounded input, retention, deletion, opt-out, and rollback behavior.
- Every slice requires tests, build, lint, format, docs, security/audit checks, a Discord smoke test, and release notes.

## v0.9 Slice Order

1. **Daily rewards foundation (#22)**: atomic once-per-day claim, bounded reward, opt-out, retention, `/daily`, and aggregate audit.
2. **Participation streaks (#14)**: derive streaks from qualifying activity without message content, anti-spam caps, reset behavior, and `/streak`.
3. **Member profile cards (#9)**: opt-in profile display, server identity resolution, private edit/delete, and Command Deck visibility.
4. **Game roles (#45)**: allowlisted self-service role toggles with hierarchy checks and no role creation.
5. **Persistent teams (#48)**: server-scoped create/join/leave/list with limits, ownership transfer, and deletion.
6. **MuthaShip Coins and ambassador cards (#186)**: economy ledger layered on reward/streak primitives, admin pause/reset, card collection, and explicit trading design gate.
7. **v0.9.0 release**: integrate aggregate metrics, update documentation, rehearse migration/rollback, tag, deploy, and verify each module in Discord and the Command Deck.

## First Slice: Daily Rewards (#22)

### Task 1: Repository contract and migration

**Files:**

- Create or modify the engagement storage repository and migration files following existing SQLite conventions.
- Test: `tests/daily-reward-storage.test.ts`.

- [ ] Write failing tests for one claim per server/member/day, duplicate idempotency, opt-out exclusion, server isolation, bounded retention, and deletion.
- [ ] Run `npm test -- --run tests/daily-reward-storage.test.ts` and confirm expected failures.
- [ ] Add a parameterized ledger table with server/member/day uniqueness and a bounded reward record.
- [ ] Add repository methods `claimDailyReward`, `getDailyRewardStatus`, `setDailyRewardOptOut`, `deleteDailyRewardData`, and `cleanupDailyRewards`.
- [ ] Rerun focused tests and confirm green.

### Task 2: Service and Discord command

**Files:**

- Create `src/engagement/daily-rewards.ts`.
- Modify command definitions and handlers.
- Test: `tests/daily-reward-command.test.ts`.

- [ ] Write failing tests for `/daily` success, duplicate claim, opt-out, safe private response, and bounded reward output.
- [ ] Run the focused test and confirm it fails for the missing service/command.
- [ ] Implement `DailyRewardService.claim(serverId, memberId, now)` with deterministic UTC day keys and repository idempotency.
- [ ] Register `/daily` plus `/daily opt-out` and `/daily opt-in`; keep responses concise and private where balance details appear.
- [ ] Rerun focused tests and confirm green.

### Task 3: Documentation, release evidence, and PR

**Files:**

- Modify `docs/ROADMAP.md`, `docs/ENGAGEMENT_RUNBOOK.md`, `docs/CONFIGURATION.md`, `README.md`, and `CHANGELOG.md`.
- Create `docs/releases/v0.9.0.md` only when the full release scope is complete.

- [ ] Document the slice contract, retention, opt-out, deletion, migration, rollback, and manual Discord smoke test.
- [ ] Run `npm test`, `npm run build`, `npm run lint`, `npm run format:check`, `npm run docs:check`, `npm audit --audit-level=high`, and `git diff --check`.
- [ ] Open a focused PR, wait for CI, review the diff, merge through protected main, tag the slice release only after deployment verification.

## Release Gate

No issue is closed until implementation, tests, docs, CI, migration rehearsal, Discord smoke test, deployment identity, and rollback evidence are recorded. If a slice is implemented but not tagged and deployed, it remains “implemented, unreleased.”
