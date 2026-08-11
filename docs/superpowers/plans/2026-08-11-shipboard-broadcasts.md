# Jarvis v0.5.0 Shipboard Broadcasts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Jarvis v0.5.0 with shared, durable controls for scheduled community broadcasts and honest member preferences for personally targeted notifications.

**Architecture:** Existing RSS, proactive, recap, event-reminder, and birthday modules retain their domain logic. A server-scoped broadcast policy and delivery-run layer supplies destination, pause, quiet-hours, cadence, member opt-in, lease fencing, and health decisions immediately before external delivery. Discord remains the interaction surface while the localhost Command Deck projects configuration and delivery health.

**Tech Stack:** TypeScript, Node.js 22+, discord.js 14, better-sqlite3, Zod, Vitest, ESLint, Prettier, PowerShell documentation validation, GitHub Actions.

## Global Constraints

- Public channel broadcasts and personally targeted notifications are separate products.
- User-facing copy uses MuthaShip, server, channel, and crew, never guild.
- Jarvis sends no unsolicited direct messages in v0.5.0.
- Environment configuration remains the destination allowlist and cannot be widened by SQLite or the Command Deck.
- All outbound messages disable uncontrolled mentions and reject mass or role mentions in administrator-authored content.
- No message bodies, feed entries, names, secrets, or tokens enter logs or aggregate metrics.
- Global pause is checked immediately before every external post.
- Every delivery claim is restart-safe, leased, token-fenced, and truthful about failure.
- Durable preferences do not expire through generic retention cleanup.
- Every production behavior starts with a failing test and ends with a focused passing test before the full quality gate.
- The release is complete only after migration rehearsal, backup, rollback validation, Discord smoke testing, deployment verification, issue closure, tag, and GitHub release.

## Planned file structure

- Create `src/notifications/broadcast-policy.ts`: categories, decisions, member preference rules, and validation.
- Create `src/notifications/broadcast-store.ts`: policy, preference, delivery lease, and health contracts.
- Create `src/notifications/sqlite-broadcast-store.ts`: parameterized SQLite implementation and migrations.
- Create `src/commands/notifications.ts`: member-owned status, enable, and disable workflow.
- Create `src/notifications/proactive-catalog.ts`: validated administrator-approved prompt catalog.
- Modify RSS, proactive, recap, event-reminder, and birthday schedulers to use the shared policy.
- Modify `src/admin/admin-console.ts` and platform metrics for operations visibility.
- Update configuration, architecture, security, operations, troubleshooting, roadmap, changelog, and release documentation.

---

### Task 1: Shared broadcast policy and durable storage

**Files:**

- Create: `src/notifications/broadcast-policy.ts`
- Create: `src/notifications/broadcast-store.ts`
- Create: `src/notifications/sqlite-broadcast-store.ts`
- Create: `tests/broadcast-policy.test.ts`
- Create: `tests/broadcast-storage.test.ts`

**Interfaces:**

- Produces `BroadcastCategory = 'rss' | 'proactive' | 'recap' | 'event_reminder' | 'birthday'`.
- Produces `BroadcastPolicyService.evaluate(input): Promise<BroadcastDecision>`.
- Produces `BroadcastStore` methods `getPolicy`, `setPolicy`, `getMemberPreference`, `setMemberPreference`, `claimDelivery`, `completeDelivery`, `releaseDelivery`, `deliveryHealth`, and `cleanup`.

- [ ] **Step 1: Write failing policy tests**

```ts
it('rejects a destination outside the environment allowlist', async () => {
  const service = new BroadcastPolicyService(store, ['allowed']);
  await expect(
    service.evaluate({
      serverId: 'server',
      category: 'rss',
      channelId: 'other',
      now: new Date('2026-08-11T12:00:00-04:00'),
    }),
  ).resolves.toEqual({ allowed: false, reason: 'destination_not_allowed' });
});

it('does not pretend a member can disable a public-only category', () => {
  expect(memberControllable('rss')).toBe(false);
  expect(memberControllable('event_reminder')).toBe(true);
});
```

- [ ] **Step 2: Run `npm test -- --run tests/broadcast-policy.test.ts`**

Expected: FAIL because the policy module does not exist.

- [ ] **Step 3: Implement minimal types and decision service**

```ts
export type BroadcastCategory =
  'rss' | 'proactive' | 'recap' | 'event_reminder' | 'birthday';
export type BroadcastDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason:
        | 'disabled'
        | 'paused'
        | 'globally_paused'
        | 'destination_not_allowed'
        | 'quiet_hours'
        | 'cadence_limited'
        | 'member_not_opted_in';
    };
export const memberControllable = (category: BroadcastCategory): boolean =>
  category === 'event_reminder' || category === 'birthday';
```

- [ ] **Step 4: Run the policy test and confirm PASS**

- [ ] **Step 5: Write failing SQLite isolation, persistence, retention, and fencing tests**

```ts
it('isolates durable policy by server and preserves it across reopen', async () => {
  const first = new SqliteBroadcastStore(path);
  await first.setPolicy(policy('server-a', 'rss', 'enabled'));
  await first.close();
  const reopened = new SqliteBroadcastStore(path);
  expect(await reopened.getPolicy('server-a', 'rss')).toMatchObject({
    state: 'enabled',
  });
  expect(await reopened.getPolicy('server-b', 'rss')).toBeUndefined();
});

it('fences stale delivery completion with the active lease token', async () => {
  const a = await store.claimDelivery('server', 'rss', 'item', now);
  const b = await store.claimDelivery(
    'server',
    'rss',
    'item',
    afterLeaseExpiry,
  );
  expect(await store.completeDelivery('server', 'rss', 'item', a!, now)).toBe(
    false,
  );
  expect(await store.completeDelivery('server', 'rss', 'item', b!, now)).toBe(
    true,
  );
});
```

- [ ] **Step 6: Run `npm test -- --run tests/broadcast-storage.test.ts`**

Expected: FAIL because the SQLite store does not exist.

- [ ] **Step 7: Implement the three approved tables and repository methods**

Use composite primary keys, category and state `CHECK` constraints,
parameterized queries, `BEGIN IMMEDIATE` claim transactions, random lease tokens,
and token-matched completion. Cleanup deletes terminal delivery runs only and
never deletes policies or member preferences.

- [ ] **Step 8: Run both focused suites and confirm PASS**

Run: `npm test -- --run tests/broadcast-policy.test.ts tests/broadcast-storage.test.ts`

- [ ] **Step 9: Commit**

```powershell
git add src/notifications/broadcast-policy.ts src/notifications/broadcast-store.ts src/notifications/sqlite-broadcast-store.ts tests/broadcast-policy.test.ts tests/broadcast-storage.test.ts
git commit -m "feat: add durable broadcast policy foundation"
```

---

### Task 2: Honest member notification controls

**Files:**

- Create: `src/commands/notifications.ts`
- Modify: `src/commands/definitions.ts`
- Modify: `src/commands/handlers.ts`
- Modify: `src/index.ts`
- Create: `tests/notification-command.test.ts`
- Modify: `tests/commands.test.ts`
- Modify: `tests/register-commands.test.ts`
- Modify: `tests/application.test.ts`

**Interfaces:**

- Consumes member preference methods and `memberControllable` from Task 1.
- Produces `/notifications status`, `/notifications enable category:<category>`, and `/notifications disable category:<category>`.
- Produces private, mention-disabled responses only.

- [ ] **Step 1: Write failing definition and behavior tests**

```ts
it('registers status enable and disable under notifications', () => {
  const command = commandDefinitions.find(
    (item) => item.name === 'notifications',
  );
  expect(command?.options?.map((option) => option.name)).toEqual([
    'status',
    'enable',
    'disable',
  ]);
});

it('rejects public RSS as a member preference without persisting', async () => {
  await handleNotificationCommand(interaction('disable', 'rss'), dependencies);
  expect(dependencies.store.setMemberPreference).not.toHaveBeenCalled();
  expect(reply).toContain('public channel broadcast');
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- --run tests/notification-command.test.ts tests/commands.test.ts tests/register-commands.test.ts`

- [ ] **Step 3: Implement the command and private UX**

Status lists event reminders and birthday mentions. Public categories explain
that a personal toggle cannot hide a channel post and direct the member to an
administrator. All replies are ephemeral with mentions disabled.

- [ ] **Step 4: Wire the store through the handler and application lifecycle**

Construct the store beside existing notification stores and close it only after
active command and scheduler work drains.

- [ ] **Step 5: Run focused tests and confirm PASS**

Run: `npm test -- --run tests/notification-command.test.ts tests/commands.test.ts tests/register-commands.test.ts tests/application.test.ts`

- [ ] **Step 6: Commit**

```powershell
git add src/commands/notifications.ts src/commands/definitions.ts src/commands/handlers.ts src/index.ts tests/notification-command.test.ts tests/commands.test.ts tests/register-commands.test.ts tests/application.test.ts
git commit -m "feat: add honest member notification controls"
```

---

### Task 3: Retry-safe RSS digests and delivery limits

**Files:**

- Modify: `src/notifications/rss-storage.ts`
- Modify: `src/notifications/rss-scheduler.ts`
- Modify: `src/notifications/rss-notifications.ts`
- Modify: `src/commands/rss.ts`
- Modify: `src/index.ts`
- Modify: `tests/rss-storage.test.ts`
- Modify: `tests/rss-scheduler.test.ts`
- Modify: `tests/rss-notifications.test.ts`
- Modify: `tests/handlers.test.ts`
- Modify: `tests/admin-console.test.ts`

**Interfaces:**

- Consumes shared policy and delivery leases.
- Produces feed baseline state, optional digests, five-items-per-cycle and twenty-items-per-day limits, exact previews, and truthful scheduler health.

- [ ] **Step 1: Write failing baseline and retry tests**

```ts
it('baselines a new feed without publishing historical items', async () => {
  storage.addFeed('server', feedUrl, 'Xbox News');
  expect(await scheduler.tick()).toBe(0);
  expect(publisher.publish).not.toHaveBeenCalled();
});

it('retries when Discord fails before completion', async () => {
  publisher.publish.mockRejectedValueOnce(new Error('gateway'));
  await expect(scheduler.tick()).resolves.toBe(0);
  publisher.publish.mockResolvedValue(undefined);
  await expect(scheduler.tick()).resolves.toBe(1);
});
```

- [ ] **Step 2: Run RSS suites and confirm RED**

Run: `npm test -- --run tests/rss-storage.test.ts tests/rss-scheduler.test.ts tests/rss-notifications.test.ts`

- [ ] **Step 3: Replace permanent pre-post claims with leased delivery**

Persist a baseline when adding a feed. Claim, post, then complete each new item;
release or expire failures. Preserve HTTPS host allowlisting, 512 KB parsing, and
twenty parsed items.

- [ ] **Step 4: Add digest and delivery limits**

Digest at most five entries into one bounded payload with source label, title,
canonical URL, and publication time. Suppress entries after twenty completed
items per server/category/day.

- [ ] **Step 5: Add exact non-persisting preview**

Preview fetches at most five entries and states that saving establishes a
baseline rather than dumping historical posts.

- [ ] **Step 6: Run focused RSS, handler, and console tests and confirm PASS**

Run: `npm test -- --run tests/rss-storage.test.ts tests/rss-scheduler.test.ts tests/rss-notifications.test.ts tests/handlers.test.ts tests/admin-console.test.ts`

- [ ] **Step 7: Commit**

```powershell
git add src/notifications/rss-storage.ts src/notifications/rss-scheduler.ts src/notifications/rss-notifications.ts src/commands/rss.ts src/index.ts tests/rss-storage.test.ts tests/rss-scheduler.test.ts tests/rss-notifications.test.ts tests/handlers.test.ts tests/admin-console.test.ts
git commit -m "feat: make RSS delivery bounded and retry safe"
```

---

### Task 4: Administrator-approved proactive catalog

**Files:**

- Create: `src/notifications/proactive-catalog.ts`
- Modify: `src/engagement/proactive.ts`
- Modify: `src/config/config.ts`
- Modify: `src/index.ts`
- Create: `config/proactive-prompts.example.json`
- Create: `tests/proactive-catalog.test.ts`
- Modify: `tests/proactive-engagement.test.ts`
- Modify: `tests/config.test.ts`

**Interfaces:**

- Produces `ProactivePrompt { id, category, text, active, startsAt?, endsAt? }`.
- Produces `loadProactiveCatalog(path)` with a maximum of 100 entries and 1,000 characters per entry.
- Consumes shared policy and leased delivery.

- [ ] **Step 1: Write failing catalog tests**

```ts
it('rejects mass mentions, duplicate IDs, and more than one hundred prompts', async () => {
  await expect(loadCatalog(fileWith('@everyone'))).rejects.toThrow('mention');
  await expect(loadCatalog(fileWithDuplicateIds())).rejects.toThrow(
    'duplicate',
  );
  await expect(loadCatalog(fileWith101Prompts())).rejects.toThrow('100');
});

it('selects only active prompts inside their date window', () => {
  expect(selectEligiblePrompts(catalog, now).map((item) => item.id)).toEqual([
    'ready',
  ]);
});
```

- [ ] **Step 2: Run `npm test -- --run tests/proactive-catalog.test.ts` and confirm RED**

- [ ] **Step 3: Implement Zod validation and local catalog loading**

Validate stable lowercase IDs, bounded category/text, active state, ISO windows,
duplicate IDs, mass mentions, role mentions, and the 100-entry limit.

- [ ] **Step 4: Replace time-indexed templates with eligible approved prompts**

Evaluate policy immediately before post, use leased delivery, complete only after
Discord succeeds, and log safe error categories without prompt text.

- [ ] **Step 5: Run focused proactive, config, and application tests**

Run: `npm test -- --run tests/proactive-catalog.test.ts tests/proactive-engagement.test.ts tests/config.test.ts tests/application.test.ts`

- [ ] **Step 6: Commit**

```powershell
git add src/notifications/proactive-catalog.ts src/engagement/proactive.ts src/config/config.ts src/index.ts config/proactive-prompts.example.json tests/proactive-catalog.test.ts tests/proactive-engagement.test.ts tests/config.test.ts tests/application.test.ts
git commit -m "feat: add approved proactive broadcast catalog"
```

---

### Task 5: Migrate recap, event reminder, and birthday delivery

**Files:**

- Modify: `src/engagement/recap.ts`
- Modify: `src/engagement/event-scheduler.ts`
- Modify: `src/engagement/birthdays.ts`
- Modify: `src/index.ts`
- Create: `tests/broadcast-adopters.test.ts`
- Modify: `tests/recap.test.ts`
- Modify: `tests/event-scheduler.test.ts`
- Modify: `tests/birthdays.test.ts`

**Interfaces:**

- Consumes `BroadcastPolicyService.evaluate` immediately before all three external deliveries.
- Consumes member preference for event reminders and birthday mentions.
- Preserves existing domain state and idempotency.

- [ ] **Step 1: Write failing pause-race and member-opt-in tests**

```ts
it.each(['recap', 'event_reminder', 'birthday'] as const)(
  'rechecks policy immediately before %s delivery',
  async (category) => {
    policy.evaluate
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({
        allowed: false,
        reason: 'globally_paused',
      });
    await runCategory(category);
    expect(gateway.post).not.toHaveBeenCalled();
  },
);

it('does not mention a birthday member without explicit opt-in', async () => {
  preference.enabled = false;
  await birthdayScheduler.tick();
  expect(gateway.post).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run adopter suites and confirm RED**

Run: `npm test -- --run tests/broadcast-adopters.test.ts tests/recap.test.ts tests/event-scheduler.test.ts tests/birthdays.test.ts`

- [ ] **Step 3: Add policy checks without replacing domain state**

Evaluate before preparation and immediately before external delivery. Preserve
recap leases, event reminder tokens, birthday annual idempotency, and restart
recovery. Suppression is a successful no-op, not a scheduler error.

- [ ] **Step 4: Enforce member preferences**

Event reminders require the existing RSVP reminder opt-in plus the member
preference. Birthday mentions require the birthday record plus the member
preference. Missing preference defaults to disabled.

- [ ] **Step 5: Run adopter and safety suites and confirm PASS**

Run: `npm test -- --run tests/broadcast-adopters.test.ts tests/recap.test.ts tests/event-scheduler.test.ts tests/birthdays.test.ts tests/activity-safety.test.ts`

- [ ] **Step 6: Commit**

```powershell
git add src/engagement/recap.ts src/engagement/event-scheduler.ts src/engagement/birthdays.ts src/index.ts tests/broadcast-adopters.test.ts tests/recap.test.ts tests/event-scheduler.test.ts tests/birthdays.test.ts tests/activity-safety.test.ts
git commit -m "feat: apply shared policy to scheduled broadcasts"
```

---

### Task 6: Command Deck operations and aggregate delivery metrics

**Files:**

- Modify: `src/admin/admin-console.ts`
- Modify: `src/platform/metrics.ts`
- Modify: `src/storage/engagement-sqlite.ts`
- Modify: `src/index.ts`
- Modify: `tests/admin-console.test.ts`
- Modify: `tests/platform-metrics.test.ts`
- Create: `tests/broadcast-health.test.ts`

**Interfaces:**

- Consumes policy listing, delivery health, and safe aggregate metrics.
- Produces category cards and authenticated preview, pause, and resume endpoints.
- Produces metrics `delivery_attempted`, `delivery_succeeded`, `delivery_failed`, `delivery_suppressed`, and `delivery_retried`.

- [ ] **Step 1: Write failing projection and authorization tests**

```ts
it('renders category state, friendly destination, eligibility, and safe health', () => {
  const page = renderAdminConsole(snapshotWithBroadcasts());
  expect(page).toContain('RSS');
  expect(page).toContain('#jarvis-updates');
  expect(page).toContain('Next eligible');
  expect(page).not.toContain('1536175231373148181');
});

it('requires the local token and confirmation nonce for writes', async () => {
  const response = await request('/api/broadcast/rss/pause', { token: '' });
  expect(response.status).toBe(401);
  expect(await store.getPolicy('server', 'rss')).toMatchObject({
    state: 'enabled',
  });
});
```

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `npm test -- --run tests/admin-console.test.ts tests/platform-metrics.test.ts tests/broadcast-health.test.ts`

- [ ] **Step 3: Implement the safe read model and authenticated controls**

Show category state, friendly destination, quiet hours, cadence, next eligible
time, last attempt, last success, and bounded error category. Writes require
localhost, bearer token, short-lived confirmation nonce, allowlist enforcement,
and safe audit metadata. Never render raw destination IDs or content.

- [ ] **Step 4: Add content-free delivery metrics**

Record only the five bounded event names, category, UTC day, count, and duration.
Expose seven- and thirty-day summaries with existing server-scoped retention.

- [ ] **Step 5: Run admin, health, metrics, storage, and application suites**

Run: `npm test -- --run tests/admin-console.test.ts tests/platform-metrics.test.ts tests/broadcast-health.test.ts tests/engagement-storage.test.ts tests/application.test.ts`

- [ ] **Step 6: Commit**

```powershell
git add src/admin/admin-console.ts src/platform/metrics.ts src/storage/engagement-sqlite.ts src/index.ts tests/admin-console.test.ts tests/platform-metrics.test.ts tests/broadcast-health.test.ts tests/engagement-storage.test.ts tests/application.test.ts
git commit -m "feat: expose broadcast operations in Command Deck"
```

---

### Task 7: Documentation, rehearsal, deployment, and v0.5.0 release

**Files:**

- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/CONFIGURATION.md`
- Modify: `docs/SECURITY_MODEL.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/ENGAGEMENT_RUNBOOK.md`
- Modify: `docs/TROUBLESHOOTING.md`
- Modify: `docs/PLATFORM_ARCHITECTURE_ROADMAP.md`
- Modify: `docs/GITHUB_WORKFLOW.md`
- Modify: `CHANGELOG.md`
- Create: `docs/releases/v0.5.0.md`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**

- Consumes every completed v0.5.0 slice.
- Produces operator documentation, release evidence, version 0.5.0, rollback instructions, and a tagged GitHub release.

- [ ] **Step 1: Update configuration, architecture, security, and operator docs**

Document every new key, default, validation rule, restart behavior, data table,
retention rule, command, Command Deck flow, quiet-hours interpretation,
destination allowlist, and member/public distinction.

- [ ] **Step 2: Add the release smoke-test checklist**

The checklist covers `/notifications`, RSS preview and baseline, RSS retry,
proactive preview, category and global pause, restart dedupe, recap/reminder/
birthday suppression, desktop/mobile Command Deck, health, metrics, and rollback.

- [ ] **Step 3: Rehearse migration and rollback on a disposable database copy**

Create a timestamped production backup. Run the built application against a
disposable copy, verify policy defaults and migrations, stop cleanly, restore the
disposable backup, and verify the prior release can open it. Never mutate or
delete the production database during rehearsal.

- [ ] **Step 4: Run the complete quality gate**

```powershell
npm test
npm run build
npm run lint
npm run format:check
npm run docs:check
npm audit --audit-level=high
git diff --check
```

Expected: every command passes and the audit has zero high or critical findings.

- [ ] **Step 5: Run security and code review**

Review destination bypass, mentions, secrets, content logging, lease races,
duplicates, shutdown races, retention loss, and misleading success. Fix every
release blocker by first adding a failing regression test.

The review must include a cross-feature outbound lifecycle matrix for RSS,
proactive posts, recaps, event reminders, birthday mentions, and trivia result
cards. For every applicable feature, verify global/category pause at the final
pre-post boundary, member opt-in, leased retry/dedupe behavior, truthful health,
mention safety, content-free logs, and shutdown draining before SQLite closes.
Record evidence for each row rather than inferring safety from shared helpers.

- [ ] **Step 6: Version and commit the release**

```powershell
npm version 0.5.0 --no-git-tag-version
git add .env.example README.md docs CHANGELOG.md package.json package-lock.json
git commit -m "release: prepare Jarvis 0.5.0"
```

- [ ] **Step 7: Publish and close the release through GitHub**

Push, open a ready PR, wait for CI, address review, merge through protected main,
deploy the merge commit, register changed commands, execute the Discord smoke
test, verify `/status` reports 0.5.0 and the merge SHA, tag `v0.5.0`, publish the
GitHub release, close completed issues, set project items Done, and close the
v0.5.0 milestone.

---

## Plan self-review

- Every approved design section maps to Tasks 1 through 7.
- Existing domain stores remain intact while shared policy is added incrementally.
- Public and member-owned preferences remain technically honest.
- Task 1 method and type names are consumed consistently by later tasks.
- No task claims release completion before deployment, smoke testing, tagging, and issue closure.
- The v0.6 one-off broadcast composer remains outside this plan.
