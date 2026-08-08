# GitHub workflow

Jarvis uses GitHub as the authoritative record for source changes, backlog
decisions, validation, and releases. The repository is public, but the license
remains proprietary and production authority remains with the maintainer.

## Where work belongs

- **Issues**: bugs, feature requests, operational follow-ups, and discrete
  backlog items. Use the supplied forms and include reproducible evidence.
- **Discussions**: design questions, community ideas, administrator guidance,
  and topics that are not yet actionable work.
- **Projects**: prioritize and group issues into backlog, ready, active,
  review, deployed, and closed views.
- **Pull requests**: every source, documentation, workflow, or configuration
  change. Link the issue and include scope, safety impact, tests, and rollout
  notes.
- **Actions**: CI is the required gate. Workflows have read-only repository
  permissions unless a future workflow documents a narrower elevated need.
- **Releases**: publish user-facing version notes from an approved tag after
  CI, documentation, and deployment verification are complete.
- **Security**: use `SECURITY.md` for vulnerabilities. Do not put secrets or
  exploit details in public Issues, Discussions, or pull requests.

## Maintainer change path

1. Open or update an Issue with the desired outcome and boundaries.
2. Add it to the Project and assign a priority.
3. Create a `codex/` branch and make the smallest reviewable change.
4. Open a pull request using the repository template.
5. Let Actions run `verify` (tests and build). Resolve failures before merge.
6. Use squash auto-merge after the required check passes.
7. For production-impacting changes, back up SQLite, deploy the merged commit,
   and record the result in the PR or release notes.
8. Close the Issue and update the Roadmap or Changelog when behavior ships.

## Protection and automation

`main` blocks direct pushes, force-pushes, and branch deletion. The required
`verify` check must pass. Auto-merge is enabled for passing pull requests, but
deployment is intentionally not automatic. `CODEOWNERS` identifies the
maintainer for future review policies. Dependabot security updates, secret
scanning, and secret push protection are enabled.

## Public repository rules

Forks and pull requests are welcome for review, but they do not grant write or
merge access. Never commit `.env`, database files, logs, provider keys, Discord
tokens, private identifiers, or production screenshots containing sensitive
data. Public visibility does not grant permission to reuse proprietary code.
