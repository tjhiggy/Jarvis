# Contributing

Jarvis is proprietary software. Contributions are considered for this
repository, but no contribution grants any license beyond the written terms
provided by the repository owner.

## Prerequisites

- Node.js 22 or newer
- npm
- A local `.env` based on `.env.example` when running the bot

## Workflow

1. Fork the repository if you do not have write access, or work from an
   approved branch if you do.
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
```

Add or update tests for behavior changes. Update user-facing documentation,
configuration guidance, and security notes when the change affects them.

## Review expectations

Explain the problem, the intended behavior, and validation performed. Keep
examples sanitized. Reviewers may request a narrower scope, tests, or
documentation before accepting a change.
