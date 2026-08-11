# Releases

Jarvis releases are operator-owned, reviewable changes. The bot does not create
tags, push branches, publish GitHub releases, or modify repositories.

Every roadmap phase ends with a shipped version. A phase is not complete when
its pull requests merge. It is complete only after the release tag and GitHub
release exist, release notes and migration notes are published, the full test,
build, documentation, and diff gates pass, and the deployed instance completes
the smoke checklist. `v0.3.0` (Platform Core) was released on 2026-08-10. The
next planned milestone is `v0.4.0` (Crew Engagement).

## Versioning

Use Semantic Versioning: `MAJOR.MINOR.PATCH`.

- Increment **MAJOR** for incompatible configuration, command, or operational
  behavior.
- Increment **MINOR** for backward-compatible features.
- Increment **PATCH** for backward-compatible fixes and documentation-only
  corrections that are released as a versioned artifact.

The current package version is the source of truth for the working revision.
Do not invent release numbers or dates in advance.

## Validation gates

The release workstation needs Node.js 22 or newer, npm, and PowerShell 7
available as `pwsh`. Before tagging a release candidate, run the repository
quality set:

```powershell
npm test
npm run lint
npm run format:check
npm run build
npm run docs:check
git diff --check
```

Also review configuration changes against `.env.example` and
[Configuration](CONFIGURATION.md), review data-retention or deployment changes
against [Operations](OPERATIONS.md), and confirm no secrets, identifiers, or
conversation content entered the diff. Command changes require an explicit,
authorized registration decision for the target guild.

## Changelog and local tag

Update the project changelog when one is maintained for the release, or include
equivalent release notes with the change. State user-visible changes, operator
actions, configuration migrations, security impact, known limitations, and
rollback notes. Do not claim unimplemented extensions as shipped.

After review and validation, an authorized maintainer can create an annotated
local tag:

```powershell
git tag -a vMAJOR.MINOR.PATCH -m "Jarvis vMAJOR.MINOR.PATCH"
git show vMAJOR.MINOR.PATCH
```

Verify the tag points to the approved commit before any remote action.

## Remote and GitHub release actions

Only a maintainer with explicit authority should push the approved branch and
tag. The corresponding operator commands are:

```powershell
git push origin HEAD
git push origin vMAJOR.MINOR.PATCH
```

Then create the GitHub release through the organization's approved workflow.
Its notes should include:

- version and commit or tag;
- concise changes and security notes;
- configuration or deployment steps;
- validation gates completed;
- known limitations and rollback target.

Do not include secrets, private identifiers, logs containing message content, or
fabricated acknowledgements. A GitHub release is a human-authorized publication,
not an action Jarvis or a future extension may take on its own.

## Rollback

If a release is unhealthy, stop the bot gracefully, preserve content-free
incident evidence, and restore service from the previously approved Git tag and
known-good database backup where necessary. Rebuild that revision and start one
instance. Record the decision and follow up with a corrective release.

Never rewrite shared history to hide a bad release. Do not use force pushes,
delete tags, or discard backups as a rollback mechanism. Those moves trade a
recoverable incident for a forensic swamp.
