# Contributing

Jarvis is proprietary software. External code or documentation contributions
are not accepted unless the repository owner and contributor first enter a
separate written contribution agreement. Do not submit an unsolicited patch or
pull request on the assumption that public visibility or the platform's fork
button supplies that agreement. Submitting unsolicited code transfers no
ownership or license rights to the repository owner, and grants the submitter
no rights in Jarvis.

The repository is public for transparency, not open-write. The repository
owner controls merges and production deployments. Direct pushes to `main` are
blocked, pull requests require passing CI, and owner review is strongly
recommended before merging. Changes that
expand Discord authority, Sleeper write access, shell execution, arbitrary file
access, or automatic GitHub writes require a separate design and security
review.

## Prerequisites

- Node.js 22 or newer
- npm
- PowerShell 7, available as `pwsh`, for `npm run docs:check`
- A local `.env` based on `.env.example` when running the bot

## Workflow

Only maintainers and contributors already covered by a separate written
contribution agreement should use this workflow:

1. Work from an approved branch or from a fork authorized by that written
   agreement.
2. Create a focused branch using the `codex/` prefix, such as
   `codex/improve-status-output`.
3. Keep the change scoped, document any behavior change, and open a pull
   request with the validation results.

Never commit credentials, tokens, database files, logs, private identifiers,
or message contents. Do not add destructive Discord server behavior, broad
permissions, or undocumented state-changing operations.

## Validation

Before requesting review, run the full local checks:

```powershell
npm test
npm run lint
npm run format:check
npm run build
npm run docs:check
```

Add or update tests for behavior changes. Update user-facing documentation,
configuration guidance, and security notes when the change affects them.

## Review expectations

Explain the problem, the intended behavior, and validation performed. Keep
examples sanitized. Reviewers may request a narrower scope, tests, or
documentation before accepting a change.
