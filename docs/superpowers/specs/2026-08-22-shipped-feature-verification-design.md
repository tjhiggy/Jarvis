# Shipped Feature Verification Design

## Purpose

Jarvis needs one versioned inventory that proves what is shipped instead of
letting README prose, release notes, command registration, and operator claims
drift apart. The inventory must describe each customer-visible feature once and
must fail verification when a registered Discord command lacks ownership or
when cited automated evidence disappears.

## Design

The source of truth is a typed TypeScript catalog in
`src/platform/shipped-feature-catalog.ts`. Each feature record owns its Discord
commands and Command Deck workflows and records its module, audience,
configuration, permission boundary, persistence behavior, automated evidence,
and manual smoke procedure. Keeping this catalog in TypeScript lets the normal
build validate its structure and lets tests compare it directly with the real
command definitions.

`src/platform/feature-verification.ts` contains pure validation and Markdown
rendering functions. Validation checks unique feature IDs, complete and
non-duplicated command and Command Deck workflow ownership, non-empty evidence
and smoke cases, repository-contained Vitest evidence paths, and the existence
of every owner and evidence file. `src/admin/admin-console-workflows.ts` owns
the Deck workflow inventory and publishes it in the rendered console manifest.
The renderer produces
`docs/SHIPPED_FEATURE_VERIFICATION.md`, including the current result for each
record and a reconciliation summary.

`scripts/check-shipped-features.ts` loads the real command and Command Deck
workflow definitions, runs the validator, and either checks the committed
Markdown or rewrites it when called with `--write`. CI runs the check mode.
Documentation links the generated matrix from the implementation-status and
development guides.

## Status semantics

- `pass`: automated evidence exists and the feature has a runnable smoke case.
- `blocked`: implementation exists, but operator configuration or permissions
  still prevent deployment verification.
- `fail`: code or evidence contradicts the shipped claim.
- `not-applicable`: the record is intentionally informational and has no runtime
  deployment path.

The catalog describes expected status. The checker can only produce `pass` when
all structural and evidence checks succeed. A blocked or failed record remains
visible and makes the reconciliation result non-shippable.

## Scope boundaries

- This slice inventories and checks shipped behavior. It does not repair every
  defect found by the inventory.
- A discovered defect receives a focused v1.6 GitHub issue and a link from the
  reconciliation report.
- No Discord content, credentials, IDs, or member activity is stored.
- The checker uses repository files and command definitions only. It performs no
  network calls and changes no runtime state.

## Acceptance evidence

The slice is complete when the focused tests prove that missing, duplicate, or
uncited commands fail; the generated matrix is stable; the full test, build,
lint, formatting, and documentation checks pass; and GitHub issue #283 links the
merged pull request and verification output.
