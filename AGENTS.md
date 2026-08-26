# Cloud Agent notes

This file is onboarding guidance for Cloud Agents working in `tjhiggy/Jarvis`.
It does not change runtime, Discord, Sites, deploy, or CI behavior.

## Linux-first first success

On Linux Cloud Agent VMs, this is the first success path. These three commands
must pass. PowerShell is not required for them:

```bash
npm ci
npm test
npm run build
```

Use Node.js 22 or newer. Tests and the TypeScript build do not need a Discord
connection, provider keys, or a local `.env`.

## Documentation check (`docs:check`)

`npm run docs:check` requires PowerShell 7 (`pwsh`) and may be unavailable on
Linux Cloud Agent VMs.

Missing `pwsh` is not a product defect and must not fail this assignment. Do
not rewrite `docs:check` in this assignment.

## Secrets and untracked local state

Never commit `.env`, databases, logs, tokens, or secrets. That includes
provider keys, Discord tokens, SQLite files, backups, and unredacted logs.
Keep local `.env` and data files untracked.

## Repository conventions

- Create focused branches with the `codex/` prefix.
- Open a pull request against `main`. The required `verify` check must pass
  before merge.
- Squash merge. Never force-push `main`.
- Do not deploy unless the task explicitly authorizes it.

## Policy documents

Read these existing documents. Do not paste them here:

- [Security model](docs/SECURITY_MODEL.md)
- [Change management](docs/CHANGE_MANAGEMENT.md)
