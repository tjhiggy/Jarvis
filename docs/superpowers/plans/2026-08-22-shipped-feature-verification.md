# Shipped Feature Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a versioned, executable inventory that proves every shipped Jarvis feature, Discord command, and Command Deck workflow has ownership, configuration, evidence, and a manual smoke case.

**Architecture:** A typed catalog owns the feature inventory. Pure validation and rendering code reconciles that catalog with the real Discord command definitions and repository evidence, while a command-line checker keeps a generated Markdown report synchronized in CI.

**Tech Stack:** TypeScript, Node.js 22, Vitest, npm scripts, GitHub Actions, Markdown

**Spec:** `docs/superpowers/specs/2026-08-22-shipped-feature-verification-design.md`

## Global Constraints

- The verifier performs no network calls and changes no runtime state.
- No Discord content, credentials, raw IDs, or member activity enters the catalog or report.
- Every registered Discord command is owned by exactly one feature record.
- Every feature record cites at least one automated test and one concrete manual smoke case.
- Blocked or failed records keep the reconciliation result non-shippable.
- Discovered runtime defects are tracked as focused v1.6 GitHub issues rather than hidden in the matrix.

---

### Task 1: Validation domain

**Files:**

- Create: `src/platform/feature-verification.ts`
- Test: `tests/feature-verification.test.ts`

**Interfaces:**

- Consumes: `readonly CommandDefinition[]` from `src/commands/definitions.ts`
- Produces: `FeatureVerificationRecord`, `FeatureVerificationFinding`, `validateFeatureCatalog(records, commands, workflows, repositoryRoot)`, and `renderFeatureVerificationReport(result)`

- [x] **Step 1: Write failing tests for missing and duplicate command ownership**

  Create literal feature fixtures and assert that an unowned command yields `command-unowned` and duplicate ownership yields `command-duplicated`.

- [x] **Step 2: Run the focused test and verify the expected import failure**

  Run `npm test -- tests/feature-verification.test.ts` and confirm it fails because `src/platform/feature-verification.ts` does not exist.

- [x] **Step 3: Implement strict feature records and pure validation**

  Add status, audience, configuration, permissions, persistence, evidence, and smoke-case types. Validate unique IDs, exact command ownership, non-empty Deck workflows, evidence paths, and status semantics without reading network state.

- [x] **Step 4: Add renderer behavior tests and minimal Markdown renderer**

  Assert a hand-written report fragment containing the reconciliation status, feature name, command, configuration, evidence, and smoke case, then implement deterministic rendering.

- [x] **Step 5: Run the focused tests**

  Run `npm test -- tests/feature-verification.test.ts` and confirm all validation and rendering cases pass.

### Task 2: Canonical catalog and executable checker

**Files:**

- Create: `src/platform/shipped-feature-catalog.ts`
- Create: `src/admin/admin-console-workflows.ts`
- Modify: `src/admin/admin-console.ts`
- Create: `scripts/check-shipped-features.ts`
- Create: `docs/SHIPPED_FEATURE_VERIFICATION.md`
- Modify: `package.json`
- Test: `tests/shipped-feature-catalog.test.ts`

**Interfaces:**

- Consumes: `validateFeatureCatalog` and `renderFeatureVerificationReport` from Task 1, plus `createCommandDefinitions(2000, faqFixture)` and `adminConsoleWorkflows`
- Produces: `shippedFeatureCatalog`, `npm run features:check`, and `npm run features:write`

- [x] **Step 1: Write a failing real-inventory reconciliation test**

  Load the real command definitions and assert zero validation findings, exact command coverage, unique feature IDs, and evidence paths that exist beneath the repository root.

- [x] **Step 2: Run the catalog test and verify the expected missing-module failure**

  Run `npm test -- tests/shipped-feature-catalog.test.ts` and confirm it fails because the catalog does not exist.

- [x] **Step 3: Add the canonical shipped-feature catalog**

  Group commands only where they share one user outcome and runtime path. Record each Command Deck workflow, required environment configuration, permission boundary, persistence behavior, automated test files, and numbered smoke instructions.

- [x] **Step 4: Implement check and write modes**

  `npm run features:write` renders the committed report. `npm run features:check` exits nonzero for validation findings or when the committed report differs from generated output.

- [x] **Step 5: Generate the matrix and run the real-inventory test**

  Run `npm run features:write` followed by `npm test -- tests/shipped-feature-catalog.test.ts` and confirm the report is deterministic and the catalog covers every command exactly once.

### Task 3: CI and canonical documentation integration

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `scripts/validate-docs.ps1`
- Modify: `docs/IMPLEMENTATION_STATUS.md`
- Modify: `docs/DEVELOPMENT.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: `npm run features:check` from Task 2
- Produces: a CI gate and canonical links to `docs/SHIPPED_FEATURE_VERIFICATION.md`

- [x] **Step 1: Add the feature check to CI and documentation validation**

  Run the executable checker before tests in CI and require the matrix link from the README and implementation-status documentation.

- [x] **Step 2: Document operator and contributor usage**

  Explain that `features:write` updates the matrix after catalog changes and `features:check` is the read-only drift gate.

- [x] **Step 3: Run all repository verification**

  Run `npm run features:check`, `npm test`, `npm run build`, `npm run lint`, `npm run format:check`, and `npm run docs:check`. All commands must exit zero.

- [x] **Step 4: Review the diff for secrets, unsupported claims, and scope creep**

  Confirm the report contains no credentials, raw Discord IDs, member content, or foundation-only features described as shipped.

- [x] **Step 5: Commit and publish**

  Commit with `feat: add shipped feature verification matrix`, push `codex/v160-feature-matrix`, open a pull request that closes #283, wait for required checks, review, merge, and record closure evidence on #283 and parent #272.
