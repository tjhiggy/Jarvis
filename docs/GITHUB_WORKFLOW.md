# GitHub workflow

Jarvis uses GitHub as the authoritative record for source changes, backlog
decisions, validation, and releases. The repository is public, but the license
remains proprietary and production authority remains with the maintainer.

## Where work belongs

- **Issues**: bugs, feature requests, operational follow-ups, and discrete
  backlog items. Use the supplied forms and include reproducible evidence.
  When a request includes an image, attach the original image to the Issue and
  add a short caption describing what it demonstrates. Do not rely on an image
  remaining available only in chat. Redact tokens, private identifiers, and
  sensitive member data before attaching it.
- **Discussions**: design questions, community ideas, administrator guidance,
  and topics that are not yet actionable work.
- **Projects**: prioritize and group issues into backlog, ready, active,
  review, deployed, and closed views. Use a single Jarvis delivery board with
  Status, Sprint, Phase, Priority, Area, Effort, and Release fields. The
  default views are Backlog, Next Sprint, In Progress, Review, Ready to Ship,
  and Released.
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

## Sprint and release operating model

Use short, named sprints rather than an unbounded “in progress” queue. The
current sequence is:

1. **Sprint 1: v0.3.0 Platform Core** - Command Deck broadcast workflow,
   release verification, deployment smoke test, and the v0.3.0 tag/release.
2. **Sprint 2: Admin Console hardening** - safe channel selection, audit
   visibility, configuration previews, backup/rollback, and mobile polish.
3. **Sprint 3: Community engagement** - MuthaShip Coins and ambassador cards,
   daily rewards, and bounded activity earning rules.
4. **Sprint 4: Community intelligence** - approved knowledge, summaries,
   recaps, and administrator analytics.
5. **Sprint 5: Integrations** - Sleeper enhancements, GitHub read-only tools,
   RSS/stream improvements, and MCP foundations.

Only move an Issue to **Released** after its pull requests merge, the required
tests/build/docs/diff gates pass, deployment smoke testing is recorded, and a
version tag plus GitHub release are published. When the GitHub CLI reports that
the `project` scope is missing, run `gh auth refresh --hostname github.com -s
project` interactively, then retry project administration. Do not work around
the missing scope by writing an unofficial tracker.

## Protection and automation

`main` blocks direct pushes, force-pushes, and branch deletion. The required
`verify` check must pass. Auto-merge is enabled for passing pull requests, but
deployment is intentionally not automatic. `CODEOWNERS` identifies the
maintainer for future review policies. Dependabot security updates, secret
scanning, and secret push protection are enabled.

### Project automation

`.github/workflows/project-automation.yml` synchronizes the custom Project V2
fields with normal GitHub activity. New issues enter **Backlog**, opened or
reopened pull requests enter **In review**, merged pull requests enter **Done**,
and existing `phase:*` labels map to the matching Phase and Release options.

The workflow never assigns a Sprint, creates a release, or marks an item
**Released**. Those remain maintainer decisions after deployment verification.

Because the board is user-owned, configure an Actions secret named
`JARVIS_PROJECT_TOKEN` with a fine-grained token that has project access. The
repository token remains a fallback where GitHub grants sufficient access. If
the secret is absent, built-in Project workflows still handle intake and
closure, while custom field synchronization will report a permission failure.

## Public repository rules

Forks and pull requests are welcome for review, but they do not grant write or
merge access. Never commit `.env`, database files, logs, provider keys, Discord
tokens, private identifiers, or production screenshots containing sensitive
data. Public visibility does not grant permission to reuse proprietary code.
