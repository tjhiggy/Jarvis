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
- [x] Remove stale shipped claims and point administrators to GitHub Discussions and issue forms.
- [x] Remove the retired GitHub-write implementation from the compiled source tree.
- [x] Reconcile permissions, shipped-feature ownership, help, and canonical command documentation.
- [ ] Close #284 with evidence.

## Task 3: Add the canonical Discord journey catalog

- [x] Define typed scenarios and validators for commands, interactions, states, visibility, configuration, permissions, supporting evidence, manual obligations, and defects.
- [x] Require every registered command to own an explicit journey row without misrepresenting supporting tests as deployed proof.
- [x] Generate `docs/DISCORD_JOURNEY_VERIFICATION.md` deterministically.
- [x] Add catalog and rendering regressions.

## Task 4: Execute evidence and emit a sanitized receipt

- [x] Add a focused per-file Vitest runner that removes inherited credentials without claiming filesystem or network isolation.
- [x] Write ignored `.artifacts/qa/discord-journeys.json` using an allowlist-only schema.
- [x] Add `journeys:check`, `journeys:write`, and `journeys:verify` scripts.
- [x] Prove raw content, secrets, paths, IDs, URLs, and diagnostic payloads cannot enter the receipt.

## Task 5: Integrate, review, and publish

- [x] Run journey checks in CI and documentation validation.
- [x] Update README, development, implementation status, setup, and command-surface documentation.
- [x] Run independent code review and the full release-quality gate.
- [ ] Create, monitor, and merge the PR; rerun gates on merged main.
- [ ] Attach closure evidence to #282, #284, and parent #272.
