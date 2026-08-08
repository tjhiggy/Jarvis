# Change management

Every Jarvis change follows the same traceable path. This applies to code,
configuration, documentation, GitHub settings, Discord registration, and
production deployment.

## Standard record

1. **Request**: record the requested outcome and any safety boundaries.
2. **Scope**: identify the issue, affected files or settings, and explicit
   non-goals. Do not infer destructive authority.
3. **Plan**: for multi-step work, save a plan under `docs/superpowers/plans/`.
4. **Implementation**: work on a `codex/` branch. Keep secrets, databases,
   logs, and local assets out of commits unless explicitly intended.
5. **Validation**: run focused tests first, then `npm run docs:check`,
   `npm test`, `npm run build`, and targeted lint or formatting checks as
   applicable. Record failures and their resolution.
6. **Pull request**: include a summary, safety impact, validation results, and
   known limitations. CI must pass before merge.
7. **Merge**: merge only the passing PR. Squash commits and delete the feature
   branch when appropriate. Never force-push `main`.
8. **Deployment**: only deploy after explicit authorization. Back up SQLite,
   update to merged `main`, build, restart one process, and verify startup,
   scheduler health, and the changed behavior.
9. **External settings**: document GitHub, Discord, provider, or other hosted
   changes separately from source changes. Never place credentials in records.
10. **Closeout**: record the commit, PR, deployment result, tests, backups,
    manual setup, limitations, and recommended next step.

## Safety gates

- Public GitHub changes require a history secret audit before publication.
- Production changes require a recoverable database backup and one-process
  verification.
- Discord changes must be least-privilege and narrowly scoped; no server
  deletion, moderation, role, channel, or permission changes are implied.
- Jarvis remains read-only for Sleeper and has no shell, code execution,
  arbitrary file access, GitHub-write, or autonomous-learning capability.

## Evidence to retain

Keep the PR, CI result, commit SHA, deployment timestamp, safe startup logs,
and verification result. Do not retain or publish message contents, tokens,
API keys, database contents, or private Discord identifiers.
