# Engagement V1

**Status: implemented, unreleased.**

Engagement V1 adds deliberately bounded participation features to Jarvis. It is
disabled by default and must be enabled only after an operator configures the
feature channels and engagement administrator roles.

## Included

- Guided introductions with private preview, explicit confirmation, owner
  deletion, configured-channel delivery, and retention cleanup.
- Suggestions with private preview, confirmation, owner deletion before
  triage, and administrator-only status controls for Jarvis-owned cards.
  Suggestions do not create GitHub issues or any other external write.
- Administrator-created events with timezone validation, capacity-aware RSVP
  and waitlist handling, optional reminder opt-in, and durable delivery leases.
- Weekly recaps that use only aggregate, guild-scoped engagement data. They do
  not read Discord history or reveal member names or submitted text.
- Curated local trivia with a bounded round, answer controls, duplicate-answer
  protection, results cards, and participant opt-in and opt-out.
- Private `/engagement` status, pause, resume, and guild-scoped retained-data
  deletion controls. Pausing applies to scheduled recap, reminder, and trivia
  result delivery.

## Security and privacy boundaries

- No privileged Discord intents or Administrator permission are required.
  Configure only **View Channel**, **Read Message History**, **Send Messages**,
  and **Embed Links** in each engagement channel; members need **Use
  Application Commands**.
- Jarvis operates only in explicitly configured engagement channels and only
  creates, edits, or removes content it owns. It cannot manage Discord roles,
  channels, permissions, members, settings, or webhooks.
- Engagement data is retained in local SQLite under the configured retention
  policy. Backups are historical copies and must be protected as production
  personal data.

## Operator actions before any release

1. Resolve the TypeScript 7.0 and `typescript-eslint` compatibility mismatch,
   then run the full lint gate.
2. Back up the stopped SQLite database or Docker volume before upgrading or
   migrating it. Run exactly one Jarvis process against the database.
3. Run `npm run register-commands` only in the authorized target guild after
   command-definition changes. This bulk-replaces only this application's
   guild command set.
4. Exercise introductions, suggestions, events and RSVP, recap preview, and
   trivia in a non-sensitive test guild. Verify `/engagement status` and a
   pause/resume cycle, then monitor one scheduled cycle with safe logs.
5. Deploy and publish only after explicit maintainer authorization. Keep the
   prior approved revision and a protected database backup for rollback.

## Validation snapshot

On 2026-08-08, final hardening verification passed 53 test files and 677 tests; `npm run build`,
`npm run docs:check`, and `git diff --check` also passed. Repository-wide lint
was blocked before ESLint inspected project files because installed
`typescript-eslint` does not support the locked TypeScript 7.0 version. No
test-guild exercise, production backup, deployment, registration, release, or
scheduled-cycle monitoring was performed for this unreleased snapshot.

For the operating and rollback procedure, see the
[Engagement V1 runbook](../ENGAGEMENT_RUNBOOK.md).
