# Discord Journey Verification Design

## Goal

Prove the published Discord and community journeys behind v1.6 without requiring production Discord credentials, while keeping deployed configuration and mobile rendering obligations explicit.

## Design

Jarvis will own a typed journey catalog separate from the shipped-feature ownership catalog. Each row names a feature, Discord entry point, state, visibility, required configuration and permissions, executable Vitest evidence, manual obligation, and optional focused defect. Automated verification runs the exact unique evidence files in a disposable environment and writes an ignored, allowlist-only receipt.

Outcomes are `verified-automated`, `manual-required`, `configuration-dependent`, `defect-linked`, or `not-applicable`. A file existing is not proof. Manual mobile rendering, live registration, OAuth scopes, and production permissions cannot be called automated passes.

## Boundaries

- No Discord token, production database, network, `.env`, member identity, message content, prompt, raw provider response, or production identifier.
- Temporary synthetic state only.
- Receipt fields are fixed to version, Node version, scenario IDs, repository-relative evidence files, aggregate counts, duration, exit status, and redaction result.
- Broken journeys are fixed with regressions or linked to focused v1.6 defects.

## Product reconciliation

Issue #284 is repaired by following the approved product direction: feature intake stays in native GitHub Discussions and issue forms, not Jarvis. Stale `/feature-request` claims and dead runtime wiring are removed while the fixed-repository `/github` command remains read-only.

## Closure

The automated slice can merge when catalog validation, focused execution, receipt redaction, full tests, build, lint, formatting, documentation, and Linux CI pass. Issue #282 closes only when any remaining manual and deployed-configuration rows have evidence or focused defect links.
