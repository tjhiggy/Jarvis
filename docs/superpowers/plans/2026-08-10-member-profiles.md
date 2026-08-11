# Member Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Ship privacy-safe, opt-in MuthaShip member profiles as the first Jarvis v0.4 Crew Engagement capability.

**Architecture:** Add a dedicated `MemberProfileService` and replaceable repository, backed by an additive SQLite migration. Discord handlers resolve current member identity at display time, while profile content remains server-scoped, owner-controlled, and invisible until confirmed. Existing platform authorization, safe UI serialization, metrics, feature flags, and owner-data deletion are reused rather than cloned.

**Tech Stack:** TypeScript, Node.js 22+, discord.js 14, better-sqlite3, Vitest, existing Jarvis platform contracts and Discord UI helpers.

## Global Constraints

- Follow the approved design in `docs/superpowers/specs/2026-08-10-member-profiles-design.md`.
- Use the term `MuthaShip` or `server` in user-facing copy. Keep `guildId` only in internal Discord/API identifiers where renaming would add noise without changing behavior.
- No new Discord gateway intents, server-setting changes, roles, channels, shell execution, arbitrary file access, or external writes.
- No profile exists until its owner confirms a private preview.
- Every repository operation uses both server ID and user ID.
- Never log bio, interests, draft content, avatar URLs, display names, or deleted content.
- Hidden and missing profiles return the same non-owner response.
- Profiles are durable until explicit deletion and are excluded from generic engagement retention cleanup.
- All public and private Discord payloads disable uncontrolled mentions.
- Implement with red-green-refactor cycles and small commits. Do not weaken a test to make implementation pass.

---

## Task 1: Lock the feature-flag default and operator control contract

**Files:**

- Modify: `src/engagement/feature-flags.ts`
- Modify: `src/commands/definitions.ts`
- Modify: `src/commands/engagement.ts`
- Modify: `src/commands/handlers.ts`
- Modify: `src/index.ts`
- Modify: `tests/feature-flags.test.ts`
- Modify: `tests/engagement-control.test.ts`
- Modify: `tests/commands.test.ts`
- Modify: `tests/register-commands.test.ts`
- Modify: `docs/FEATURE_FLAGS.md`

**Interfaces and behavior:**

```ts
export type FeatureFlagName =
  | 'introductions'
  | 'suggestions'
  | 'events'
  | 'trivia'
  | 'birthdays'
  | 'roles'
  | 'proactive'
  | 'recaps'
  | 'profiles';

const FEATURE_DEFAULTS: Readonly<Record<FeatureFlagName, boolean>> = {
  introductions: true,
  suggestions: true,
  events: true,
  trivia: true,
  birthdays: true,
  roles: true,
  proactive: true,
  recaps: true,
  profiles: false,
};
```

Add admin-only `/engagement feature action:<status|enable|disable> name:<profiles>` using the existing configured administrator role gate. The initial command intentionally exposes only `profiles`; broad flag editing belongs in the Command Deck phase.

**Steps:**

1. Add failing tests proving `profiles` defaults disabled while every existing feature retains its current enabled default.
2. Add failing command tests proving non-admins are denied, status is private, enable/disable persists through `FeatureFlagService`, and unknown names cannot be supplied.
3. Run `npm test -- --run tests/feature-flags.test.ts tests/engagement-control.test.ts tests/commands.test.ts tests/register-commands.test.ts` and confirm the intended failures.
4. Implement the defaults map and the bounded admin subcommand.
5. Inject `FeatureFlagService` through `CommandDependencies` in `src/index.ts`.
6. Re-run the focused tests and expect them to pass.
7. Run `npm run build`.
8. Commit: `feat: add safe profile feature control`.

## Task 2: Define the profile domain, validation, and draft lifecycle

**Files:**

- Create: `src/engagement/member-profiles.ts`
- Create: `tests/member-profiles.test.ts`

**Interfaces:**

```ts
export interface MemberProfile {
  readonly serverId: string;
  readonly userId: string;
  readonly bio: string | null;
  readonly interests: string | null;
  readonly visibility: 'visible' | 'hidden';
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface MemberProfileRepository {
  get(serverId: string, userId: string): Promise<MemberProfile | undefined>;
  create(profile: MemberProfile): Promise<'created' | 'duplicate'>;
  update(
    serverId: string,
    userId: string,
    values: Pick<MemberProfile, 'bio' | 'interests' | 'updatedAt'>,
  ): Promise<boolean>;
  setVisibility(
    serverId: string,
    userId: string,
    visibility: MemberProfile['visibility'],
    updatedAt: Date,
  ): Promise<boolean>;
  delete(serverId: string, userId: string): Promise<boolean>;
}

export interface IntroductionInterestReader {
  getSuggestedInterests(
    serverId: string,
    userId: string,
  ): Promise<string | null>;
}
```

`MemberProfileService` owns bounded validation, mass/role mention rejection, mention neutralization, 15-minute in-memory drafts, a per-owner draft cap, owner/server binding, confirmation locks, replay safety, and safe typed errors.

**Steps:**

1. Write failing tests for valid empty optional fields, trimming, maximum lengths, excessive lengths, mass/role mentions, and safe neutralization.
2. Write failing tests for create/edit/delete drafts, introduction suggestion fallback, expiry, per-owner cap, cancel, wrong owner, wrong server, concurrent confirm, and replay.
3. Run `npm test -- --run tests/member-profiles.test.ts` and confirm failures.
4. Implement the smallest service and interfaces that satisfy the tests. Reuse safe text utilities where available instead of inventing another sanitizer.
5. Re-run the focused suite and build.
6. Commit: `feat: add member profile domain service`.

## Task 3: Add additive SQLite persistence and isolation guarantees

**Files:**

- Modify: `src/storage/engagement-sqlite.ts`
- Modify: `src/engagement/storage.ts`
- Modify: `tests/engagement-storage.test.ts`
- Create: `tests/member-profile-storage.test.ts`

**Schema:**

```sql
CREATE TABLE engagement_member_profiles (
  server_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  bio TEXT,
  interests TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('visible', 'hidden')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (server_id, user_id)
);

CREATE INDEX engagement_member_profiles_visibility
  ON engagement_member_profiles (server_id, visibility, updated_at);
```

Use the next available migration number after rechecking `engagement_schema_migrations` immediately before implementation. Do not hardcode migration 25 if another merged change has already claimed it.

**Steps:**

1. Add failing integration tests for create/read/update/hide/show/delete, reopen persistence, duplicate create, and same-user isolation between two servers.
2. Add a migration test starting from the prior schema version.
3. Add a failing regression proving generic engagement cleanup does not delete profiles.
4. Add a failing regression proving `deleteOwnerData(serverId, userId)` deletes only the target server profile and includes it in the truthful count.
5. Run the focused storage suites and confirm failures.
6. Implement parameterized queries, migration, adapter methods, and owner-data deletion integration.
7. Re-run focused tests, then `npm run build`.
8. Commit: `feat: persist server scoped member profiles`.

## Task 4: Build private profile previews and confirmation buttons

**Files:**

- Create: `src/commands/member-profile.ts`
- Modify: `src/engagement/discord-ui.ts`
- Modify: `src/discord/handlers.ts`
- Modify: `tests/preview-buttons.test.ts`
- Create: `tests/member-profile-command.test.ts`

**Button contract:**

```text
preview:v1:profile:<draft-id>:confirm
preview:v1:profile:<draft-id>:cancel
```

The preview is ephemeral and labels whether interests came from an existing introduction. Confirmation creates or edits exactly once. Cancel and expiry save nothing.

**Steps:**

1. Add failing parser/router tests for bounded IDs, profile kind, confirm/cancel, malformed IDs, wrong owner, wrong server, wrong channel, non-bot message, and duplicate clicks.
2. Add failing command tests for private create/edit/delete previews and safe error mapping.
3. Run the focused tests and capture the expected red result.
4. Extend the shared preview router and serializer without breaking introduction or suggestion buttons.
5. Implement profile preview cards using existing embed/button helpers and disabled mentions.
6. Log only operation, safe error code, server ID, user ID, and correlation ID.
7. Re-run focused tests and build.
8. Commit: `feat: add private member profile previews`.

## Task 5: Register and handle the `/profile` command surface

**Files:**

- Modify: `src/commands/definitions.ts`
- Modify: `src/commands/handlers.ts`
- Modify: `src/index.ts`
- Modify: `tests/commands.test.ts`
- Modify: `tests/register-commands.test.ts`
- Modify: `tests/application.test.ts`
- Modify: `tests/member-profile-command.test.ts`

**Command surface:**

```text
/profile create bio:<optional> interests:<optional>
/profile view member:<optional>
/profile edit bio:<optional> interests:<optional>
/profile hide
/profile show
/profile delete
```

The `member` option uses Discord's user option type, not a raw ID string. Bot targets are rejected. `/profile view` is public for a visible profile and private for an owner's hidden profile. Hidden and absent third-party profiles return the same neutral response.

**Steps:**

1. Add failing registration tests for the exact subcommands, option types, bounds, and optionality.
2. Add failing handler tests for server-only and allowlist gates, profiles-disabled response, bot rejection, owner view, visible member view, hidden/missing neutrality, hide/show, and deletion preview.
3. Assert current display name, avatar, and joined date are read from the interaction and never passed to repository writes.
4. Implement command registration, routing, service injection, and feature-flag enforcement.
5. Emit aggregate `command_started`, `command_succeeded`, `command_failed`, and profile lifecycle metrics without profile content.
6. Run focused tests, build, then the full test suite.
7. Commit: `feat: expose opt in member profiles`.

## Task 6: Complete operational deletion and privacy behavior

**Files:**

- Modify: `src/commands/engagement.ts`
- Modify: `src/engagement/deletion.ts`
- Modify: `src/storage/engagement-sqlite.ts`
- Modify: `tests/engagement-deletion.test.ts`
- Modify: `tests/member-profile-command.test.ts`

**Steps:**

1. Add failing tests proving owner `/engagement delete` removes the profile and an authorized admin can delete the target's server-scoped profile.
2. Prove an admin cannot view hidden content before or after deletion.
3. Prove deletion reporting is truthful when the profile is already absent or storage fails.
4. Implement the smallest integration into the existing deletion service. Do not add a separate admin backdoor.
5. Re-run focused and full tests.
6. Commit: `fix: include profiles in owner data deletion`.

## Task 7: Update help, operator documentation, and release evidence

**Files:**

- Modify: `README.md`
- Modify: `docs/ENGAGEMENT_PRODUCT_SPEC.md`
- Modify: `docs/ENGAGEMENT_RUNBOOK.md`
- Modify: `docs/FEATURE_FLAGS.md`
- Modify: `docs/SECURITY_MODEL.md`
- Modify: `docs/PLATFORM_ARCHITECTURE_ROADMAP.md`
- Modify: `docs/ROADMAP.md`
- Modify: `CHANGELOG.md`
- Create: `docs/release-notes/v0.4.0.md`
- Modify: command help copy in the existing help command source
- Modify: `tests/commands.test.ts`

**Steps:**

1. Document who can create/view/change/delete profiles, exact persistence, hidden-profile behavior, introduction suggestion consent, and the disabled-by-default rollout.
2. Document `/engagement feature` enable/disable/status and rollback.
3. Mark the capability `implemented, unreleased` until the v0.4.0 tag exists. Do not call it shipped early. That trick fooled nobody last time.
4. Add manual QA steps for Discord desktop and mobile.
5. Run `npm run docs:check`, `npm test -- --run tests/commands.test.ts`, and `npx prettier --check` on every touched documentation file.
6. Commit: `docs: document member profile operations`.

## Task 8: Perform security and regression review

**Files:**

- Review all files changed since `origin/main`
- Add regression tests to the closest existing test file for every confirmed gap

**Review checklist:**

- No cross-server lookup or update.
- No hidden-profile existence oracle.
- No content or identity values in logs or metrics.
- No uncontrolled mentions.
- No new privileged Discord intent or permission.
- Preview controls are owner/server/channel/message bound and replay-safe.
- Feature flag defaults off for profiles only.
- Database migration is additive and rollback-safe.
- Generic retention does not remove profiles.
- Authorized deletion truly deletes profile data.

**Steps:**

1. Review `git diff origin/main...HEAD` using the repository security model.
2. Run a targeted security scan for secrets, raw content logging, dynamic evaluation, shell execution, arbitrary file access, and Discord mutation.
3. Add failing regression tests for every validated finding, then fix them.
4. Run the focused suites again.
5. Commit only if fixes were required: `fix: harden member profile boundaries`.

## Task 9: Run the complete automated release gate

**Commands and expected outcomes:**

1. `npm test -- --run` - every test passes.
2. `npm run build` - TypeScript compilation succeeds.
3. `npm run docs:check` - documentation contract succeeds.
4. `npm run lint` - succeeds, or the existing TypeScript 7/typescript-eslint incompatibility is fixed before release. A known broken lint gate is still a broken gate, not a charming personality quirk.
5. `npm run format:check` - succeeds for the repository.
6. `git diff --check origin/main...HEAD` - no whitespace errors.
7. `git status --short` - only intentionally ignored local artifacts remain.

If lint remains blocked by the current dependency mismatch, fix the toolchain in a separate, reviewed commit before declaring v0.4.0 releasable. Do not waive it silently.

Commit any gate-only fixes with an accurate conventional commit message.

## Task 10: PR review, deployment, smoke test, and v0.4.0 release

**GitHub and deployment steps:**

1. Update PR #196 from draft to ready only after Tasks 1-9 pass.
2. Ensure the PR description links issue #7 and includes design, migration, privacy, rollback, automated evidence, and manual QA checklist.
3. Wait for required GitHub checks, address review findings, and merge with the repository's normal protected-branch process.
4. Back up `data/discord-bot.db` using the documented safe deployment procedure.
5. Pull the merged `main`, install the lockfile state, build, register guild commands, and restart Jarvis gracefully.
6. Enable `profiles` only in the test MuthaShip using the admin feature command.
7. Execute the approved desktop/mobile smoke test from the design specification in channel `1536175231373148181`.
8. Confirm `/engagement metrics` records aggregate profile command results without content and `/engagement status` remains healthy.
9. On failure, disable `profiles`, restore the previous application build, and retain the additive profile table for safe retry. Restore the database backup only for a verified migration/data-integrity failure.
10. After smoke-test approval, update `package.json` and release metadata consistently to `0.4.0` if not already done, create tag `v0.4.0`, and publish a GitHub Release from `docs/release-notes/v0.4.0.md`.
11. Verify Jarvis reports `0.4.0`, the production commit SHA, and production deployment identity.
12. Close issue #7 with links to the merged PR, release, test evidence, and any deliberately deferred follow-ups.

## Final acceptance checklist

- [ ] Profiles are opt-in and disabled by default per server.
- [ ] Admins have an operable, private enable/disable/status control.
- [ ] No profile is stored before owner confirmation.
- [ ] Current Discord identity is displayed without being persisted.
- [ ] Visible profiles are server-local; hidden/missing behavior is neutral.
- [ ] Owners can edit, hide, show, and permanently delete.
- [ ] Authorized owner-data deletion includes profiles without exposing content.
- [ ] Drafts expire, are capped, and reject replay/foreign controls.
- [ ] SQLite migration, reopen, concurrency, and isolation tests pass.
- [ ] Full tests, build, docs, lint, formatting, and diff gates pass.
- [ ] Desktop and mobile Discord smoke tests pass in the configured test channel.
- [ ] PR is merged, production is deployed, `v0.4.0` is tagged, and issue #7 is closed with evidence.
