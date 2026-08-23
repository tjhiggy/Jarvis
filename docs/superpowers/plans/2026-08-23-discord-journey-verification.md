# Discord Journey Verification Implementation Plan

**Goal:** Add truthful, executable verification for all published Discord and community journeys and resolve the confirmed feature-intake documentation defect.

**Spec:** `docs/superpowers/specs/2026-08-23-discord-journey-verification-design.md`

## Task 1: Repair the red cross-platform baseline

- [x] Reproduce CRLF/LF matrix drift on Windows.
- [x] Normalize recovery matrix comparisons.
- [x] Verify the focused recovery suite.

## Task 2: Reconcile feature intake with native GitHub workflows

- [x] Confirm the command is intentionally absent from registration and routing.
- [x] Remove dead runtime construction and injection.
- [ ] Remove stale shipped claims and point administrators to GitHub Discussions and issue forms.
- [ ] Reconcile permissions, shipped-feature ownership, help, and canonical command documentation.
- [ ] Close #284 with evidence.

## Task 3: Add the canonical Discord journey catalog

- [ ] Define typed scenarios and validators for commands, interactions, states, visibility, configuration, permissions, evidence, manual obligations, and defects.
- [ ] Require every registered command to own registration, routing, visibility, state, and permission evidence.
- [ ] Generate `docs/DISCORD_JOURNEY_VERIFICATION.md` deterministically.
- [ ] Add catalog and rendering regressions.

## Task 4: Execute evidence and emit a sanitized receipt

- [ ] Add a focused per-file Vitest runner with disposable environment settings.
- [ ] Write ignored `.artifacts/qa/discord-journeys.json` using an allowlist-only schema.
- [ ] Add `journeys:check`, `journeys:write`, and `journeys:verify` scripts.
- [ ] Prove raw content, secrets, paths, IDs, URLs, and diagnostic payloads cannot enter the receipt.

## Task 5: Integrate, review, and publish

- [ ] Run journey checks in CI and documentation validation.
- [ ] Update README, development, implementation status, setup, and command-surface documentation.
- [ ] Run independent code review and the full release-quality gate.
- [ ] Create, monitor, and merge the PR; rerun gates on merged main.
- [ ] Attach closure evidence to #282, #284, and parent #272.
