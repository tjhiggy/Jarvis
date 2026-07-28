# Jarvis Project Documentation Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete, accurate, proprietary documentation suite for
MuthaShip Jarvis and its GitHub repository.

**Architecture:** Keep `README.md` as the concise navigation hub and place
operational depth in focused files under `docs/`. Repository policies remain at
the root, GitHub contribution metadata lives under `.github/`, and a
PowerShell validator checks links, placeholders, YAML syntax, documented
configuration, and likely secrets.

**Tech Stack:** Markdown, Mermaid, GitHub issue forms, Dependabot YAML,
PowerShell 7, TypeScript project metadata, npm, Prettier, Vitest, ESLint

## Global Constraints

- Jarvis is proprietary and all rights reserved.
- Publishing source code grants no permission to copy, modify, redistribute,
  sublicense, or use it commercially.
- Describe only behavior verified in source, tests, configuration, or current
  operating scripts.
- Never include local secret values, Discord IDs, API keys, database contents,
  private invite codes, or private machine-specific logs.
- Use clearly labeled placeholders for credentials and identifiers.
- Never claim Jarvis executes code, changes repositories, administers Discord,
  writes to GitHub, or learns by training on Discord conversations.
- Destructive Discord administration remains out of scope.
- Preserve MuthaShip flavor sparingly and prioritize operational clarity.
- Do not add runtime dependencies.
- Do not push the branch or open a pull request without explicit user approval.

---

## File Map

### Repository policy and navigation

- Modify `README.md`: project entrance, verified capability summary, quick start,
  limitations, and links to focused guides.
- Create `LICENSE.md`: proprietary all-rights-reserved terms.
- Create `CHANGELOG.md`: release history beginning with `v0.1.0`.
- Create `CONTRIBUTING.md`: safe contributor workflow and verification gates.
- Create `SECURITY.md`: supported versions and private reporting procedure.
- Create `SUPPORT.md`: support scope and diagnostic intake.
- Create `CODE_OF_CONDUCT.md`: Contributor Covenant-based expectations without a
  fabricated contact address.

### Technical and operating guides

- Create `docs/ARCHITECTURE.md`: components, request flow, storage, trust
  boundaries, and extension contracts.
- Create `docs/CONFIGURATION.md`: exact environment-variable reference.
- Create `docs/DISCORD_SETUP.md`: minimum-permission Discord setup.
- Create `docs/DEVELOPMENT.md`: local development and validation workflow.
- Create `docs/DEPLOYMENT.md`: native Windows and Docker deployment.
- Create `docs/OPERATIONS.md`: lifecycle, monitoring, logs, backup, and recovery.
- Create `docs/TROUBLESHOOTING.md`: symptom-driven diagnosis.
- Create `docs/SECURITY_MODEL.md`: assets, controls, threats, and backlog.
- Create `docs/RELEASES.md`: versioning and release procedure.
- Create `docs/ROADMAP.md`: current foundation and unimplemented capabilities.
- Create `docs/extensions/README.md`: safe extension contracts and sequencing.

### GitHub workflow metadata

- Create `.github/ISSUE_TEMPLATE/bug_report.yml`: structured bug intake.
- Create `.github/ISSUE_TEMPLATE/feature_request.yml`: problem-first feature
  requests.
- Create `.github/ISSUE_TEMPLATE/config.yml`: support and security routing.
- Create `.github/pull_request_template.md`: change and verification checklist.
- Create `.github/dependabot.yml`: monthly bounded dependency updates.

### Validation

- Create `scripts/validate-docs.ps1`: deterministic documentation checks.
- Modify `package.json`: add `"docs:check"` script.

---

### Task 1: Repository Policy Documents

**Files:**

- Create: `LICENSE.md`
- Create: `CHANGELOG.md`
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `SUPPORT.md`
- Create: `CODE_OF_CONDUCT.md`

**Interfaces:**

- Consumes: version `0.1.0` from `package.json`, commands from `package.json`,
  branch name prefix `codex/`, and the approved proprietary licensing stance.
- Produces: stable policy targets linked by `README.md` and GitHub templates.

- [ ] **Step 1: Inventory exact project facts**

Run:

```powershell
Get-Content package.json
git tag --list
git log --oneline --decorate -10
```

Expected: package version `0.1.0`, tag `v0.1.0`, and scripts for development,
build, test, lint, formatting, and command registration.

- [ ] **Step 2: Draft the six policy documents**

Write concise Markdown with these exact responsibilities:

- `LICENSE.md`: copyright `2026 Jim Higgins`, all rights reserved, and explicit
  prohibition on copying, modification, redistribution, sublicensing, and
  commercial use without prior written permission.
- `CHANGELOG.md`: Keep a Changelog headings with `Unreleased` and `0.1.0 -
2026-07-28`; list Discord commands, channel memory, Ollama/OpenAI providers,
  Tavily grounding, SQLite, security controls, Docker, native startup, tests,
  icon, and banner.
- `CONTRIBUTING.md`: prerequisites, fork or branch workflow, no secrets, no
  destructive server behavior, test expectations, documentation requirements,
  and `npm test`, `npm run lint`, `npm run format:check`, `npm run build`.
- `SECURITY.md`: current supported line `0.1.x`, use GitHub private vulnerability
  reporting when enabled, otherwise contact the repository owner privately
  through GitHub, never open a public secret-bearing issue, and provide a
  best-effort response policy without invented time guarantees.
- `SUPPORT.md`: route usage questions to GitHub Discussions if enabled or a
  sanitized issue, list safe diagnostic fields, and route vulnerabilities to
  `SECURITY.md`.
- `CODE_OF_CONDUCT.md`: Contributor Covenant 2.1 substance, enforcement by
  repository maintainers through private GitHub contact, and no fake email.

- [ ] **Step 3: Check policies for placeholders and secrets**

Run:

```powershell
rg -n "TBD|TODO|FIXME|example@example|your@email|sk-[A-Za-z0-9_-]{16,}|tvly-[A-Za-z0-9_-]{16,}" LICENSE.md CHANGELOG.md CONTRIBUTING.md SECURITY.md SUPPORT.md CODE_OF_CONDUCT.md
```

Expected: no matches.

- [ ] **Step 4: Format and inspect the policy diff**

Run:

```powershell
npx prettier --write LICENSE.md CHANGELOG.md CONTRIBUTING.md SECURITY.md SUPPORT.md CODE_OF_CONDUCT.md
git diff --check
git diff --stat
```

Expected: Prettier succeeds and `git diff --check` produces no errors.

- [ ] **Step 5: Commit the policy set**

```powershell
git add LICENSE.md CHANGELOG.md CONTRIBUTING.md SECURITY.md SUPPORT.md CODE_OF_CONDUCT.md
git commit -m "docs: add project policies"
```

Expected: one commit containing only the six policy files.

### Task 2: Architecture, Configuration, and Development Guides

**Files:**

- Create: `docs/ARCHITECTURE.md`
- Create: `docs/CONFIGURATION.md`
- Create: `docs/DISCORD_SETUP.md`
- Create: `docs/DEVELOPMENT.md`

**Interfaces:**

- Consumes: `src/index.ts`, `src/config/config.ts`,
  `src/commands/definitions.ts`, `src/services/conversation-service.ts`,
  `src/storage/storage.ts`, `.env.example`, `package.json`, and
  `scripts/register-commands.ts`.
- Produces: authoritative technical references used by the README, deployment,
  security, and troubleshooting guides.

- [ ] **Step 1: Extract exact implementation contracts**

Run:

```powershell
Get-Content src/config/config.ts
Get-Content src/commands/definitions.ts
Get-Content src/index.ts
Get-Content .env.example
Get-Content package.json
```

Expected: complete lists of validated environment variables, slash commands,
providers, intents, and scripts.

- [ ] **Step 2: Write `docs/ARCHITECTURE.md`**

Include:

- component responsibilities and source paths;
- a Mermaid flowchart from Discord event through allowlist, deduplication,
  permission and rate checks, storage context, optional Tavily grounding,
  selected AI provider, persistence, chunking, and safe Discord response;
- thread IDs versus normal channel IDs as conversation identifiers;
- SQLite message fields and replacement boundary;
- external trust boundaries and prohibited execution capabilities;
- `AIService`, storage, web search, and future tool interface seams.

- [ ] **Step 3: Write `docs/CONFIGURATION.md`**

Create one table containing every key from `.env.example` and
`src/config/config.ts`, including required conditions, default, purpose, safe
example, and sensitivity. Explain empty allowlists, provider-dependent OpenAI
requirements, Ollama URL behavior, input and history bounds, retry settings,
persona configuration, and restart requirements.

- [ ] **Step 4: Write Discord and development guides**

In `docs/DISCORD_SETUP.md`, document application and bot creation, private-bot
behavior, Message Content intent, minimum permissions, OAuth2 URL template,
development-guild registration, global registration as a future manual change,
and commands `/ask`, `/search`, `/forget`, `/help`, and `/status`.

In `docs/DEVELOPMENT.md`, document Node.js 22+, installation, local `.env`
creation, Ollama setup, command registration, native startup, test mocks,
repository layout, formatting, linting, build, and safe debugging.

- [ ] **Step 5: Verify exact names and format**

Run:

```powershell
$documented = Select-String -Path docs/CONFIGURATION.md -Pattern '\b[A-Z][A-Z0-9_]{2,}\b' -AllMatches | ForEach-Object Matches | ForEach-Object Value | Sort-Object -Unique
$expected = Select-String -Path .env.example -Pattern '^[A-Z][A-Z0-9_]+=' | ForEach-Object { ($_ -split '=')[0] } | Sort-Object -Unique
Compare-Object $expected $documented
npx prettier --write docs/ARCHITECTURE.md docs/CONFIGURATION.md docs/DISCORD_SETUP.md docs/DEVELOPMENT.md
git diff --check
```

Expected: no `.env.example` variables missing from the documented list, formatting
succeeds, and the diff check is clean.

- [ ] **Step 6: Commit the technical guides**

```powershell
git add docs/ARCHITECTURE.md docs/CONFIGURATION.md docs/DISCORD_SETUP.md docs/DEVELOPMENT.md
git commit -m "docs: add architecture and developer guides"
```

Expected: one commit containing the four technical guides.

### Task 3: Deployment, Operations, Security, and Roadmap Guides

**Files:**

- Create: `docs/DEPLOYMENT.md`
- Create: `docs/OPERATIONS.md`
- Create: `docs/TROUBLESHOOTING.md`
- Create: `docs/SECURITY_MODEL.md`
- Create: `docs/RELEASES.md`
- Create: `docs/ROADMAP.md`
- Create: `docs/extensions/README.md`

**Interfaces:**

- Consumes: `Dockerfile`, `docker-compose.yml`, `scripts/start-jarvis.ps1`,
  `src/ollama/ollama-service.ts`, `src/openai/openai-service.ts`,
  `src/search/web-search.ts`, storage implementation, tests, and Task 2 guides.
- Produces: safe operating and extension guidance linked by the README,
  support policy, and GitHub templates.

- [ ] **Step 1: Inspect runtime and failure behavior**

Run:

```powershell
Get-Content Dockerfile
Get-Content docker-compose.yml
Get-Content scripts/start-jarvis.ps1
Get-Content src/ollama/ollama-service.ts
Get-Content src/openai/openai-service.ts
Get-Content src/search/web-search.ts
```

Expected: verified native and container paths, log targets, retry/error behavior,
search cache settings, and provider boundaries.

- [ ] **Step 2: Write deployment and operations guides**

`docs/DEPLOYMENT.md` must cover native Windows deployment first, scheduled-task
script assumptions, Ollama readiness, Docker as an optional alternative,
persistent SQLite mounts, upgrades, backups before upgrades, rollback to a Git
tag, and graceful shutdown.

`docs/OPERATIONS.md` must cover start/stop checks, logs, `/status`, Ollama health,
database health, cleanup behavior, backup and restore using a stopped bot, rate
limits, resource pressure, outage messages, and incident triage without exposing
message content.

- [ ] **Step 3: Write troubleshooting and security guides**

`docs/TROUBLESHOOTING.md` must use symptom, likely cause, safe diagnosis, and
resolution sections for offline bot, missing commands, Discord permissions,
allowlists, AI unavailable, Ollama model missing, Tavily failures, SQLite locks,
long responses, Docker/WSL memory pressure, and duplicate processes.

`docs/SECURITY_MODEL.md` must list protected assets, trust boundaries, untrusted
Discord content, implemented controls, mass-mention protection, credential
redaction, prohibited capabilities, external-service risks, the dedicated
`SAFETY_IDENTIFIER_SECRET` hardening recommendation, and non-destructive
administration policy.

- [ ] **Step 4: Write releases, roadmap, and extension guide**

`docs/RELEASES.md` must define semantic versioning, validation gates, changelog
updates, local tags, remote push commands, GitHub release notes, and rollback
without destructive history rewriting.

`docs/ROADMAP.md` must separate shipped, next, later, and explicitly out-of-scope
work. It must not promise dates.

`docs/extensions/README.md` must define read-only-by-default contracts for GitHub,
MCP, repository analysis, pull-request summaries, weekly recaps, gaming scores,
image generation, and administrator-only commands. Each section must name
required authorization, data boundary, failure mode, and first safe milestone.

- [ ] **Step 5: Format and commit operating guides**

Run:

```powershell
npx prettier --write docs/DEPLOYMENT.md docs/OPERATIONS.md docs/TROUBLESHOOTING.md docs/SECURITY_MODEL.md docs/RELEASES.md docs/ROADMAP.md docs/extensions/README.md
git diff --check
git add docs/DEPLOYMENT.md docs/OPERATIONS.md docs/TROUBLESHOOTING.md docs/SECURITY_MODEL.md docs/RELEASES.md docs/ROADMAP.md docs/extensions/README.md
git commit -m "docs: add operations and extension guides"
```

Expected: formatting and diff checks pass, followed by one focused commit.

### Task 4: GitHub Contribution Metadata

**Files:**

- Create: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Create: `.github/ISSUE_TEMPLATE/feature_request.yml`
- Create: `.github/ISSUE_TEMPLATE/config.yml`
- Create: `.github/pull_request_template.md`
- Create: `.github/dependabot.yml`

**Interfaces:**

- Consumes: root policy documents and repository URL
  `https://github.com/tjhiggy/Jarvis`.
- Produces: GitHub-native issue, pull-request, support, and dependency-update
  workflows.

- [ ] **Step 1: Create the bug and feature issue forms**

The bug form must require a sanitized summary, reproduction steps, expected and
actual behavior, runtime mode, operating system, Node version, and confirmation
that secrets and private message contents were removed.

The feature form must require the problem, proposed outcome, user experience,
alternatives, security/data impact, and confirmation that the request does not
assume destructive Discord or GitHub permissions.

- [ ] **Step 2: Create repository routing and pull-request templates**

Disable blank issues in `config.yml`; link support questions to `SUPPORT.md` and
security reports to `SECURITY.md` using repository blob URLs.

The pull-request template must cover purpose, scope, tests, lint, formatting,
build, documentation, secrets, permissions, data migration, breaking changes,
and rollback.

- [ ] **Step 3: Add conservative Dependabot configuration**

Configure npm and GitHub Actions ecosystems for monthly checks, timezone
`America/New_York`, and a maximum of five open pull requests per ecosystem.
Do not configure automatic merging.

- [ ] **Step 4: Parse and format GitHub metadata**

Run:

```powershell
npx prettier --write .github
node -e "const fs=require('fs'); const yamlFiles=['.github/ISSUE_TEMPLATE/bug_report.yml','.github/ISSUE_TEMPLATE/feature_request.yml','.github/ISSUE_TEMPLATE/config.yml','.github/dependabot.yml']; for (const file of yamlFiles) { const text=fs.readFileSync(file,'utf8'); if (!text.trim() || !/^[A-Za-z_-]+:/m.test(text)) throw new Error('Invalid YAML shape: '+file); }"
git diff --check
```

Expected: Prettier succeeds, each YAML file has a nonempty mapping shape, and the
diff check is clean.

- [ ] **Step 5: Commit GitHub metadata**

```powershell
git add .github
git commit -m "docs: add GitHub contribution templates"
```

Expected: one commit containing only `.github` metadata.

### Task 5: Documentation Validator and README Integration

**Files:**

- Create: `scripts/validate-docs.ps1`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**

- Consumes: every document and metadata file created by Tasks 1 through 4.
- Produces: `npm run docs:check` and the final repository navigation surface.

- [ ] **Step 1: Create a failing package-script expectation**

Run:

```powershell
node -e "const p=require('./package.json'); if (!p.scripts['docs:check']) process.exit(1)"
```

Expected: exit code `1` because the script does not exist.

- [ ] **Step 2: Implement `scripts/validate-docs.ps1`**

The script must:

1. enumerate tracked `*.md`, `*.yml`, and `*.yaml` files;
2. fail on unfinished placeholder markers or dummy contact addresses;
3. fail on likely OpenAI, Tavily, Discord token, or private-key patterns;
4. resolve repository-relative Markdown links while ignoring `https:`, `http:`,
   `mailto:`, and same-page anchors;
5. verify every key in `.env.example` appears in `docs/CONFIGURATION.md`;
6. verify every package script appears in `README.md` or
   `docs/DEVELOPMENT.md`;
7. return nonzero with file-specific messages and print a concise success count
   otherwise.

Use PowerShell `Get-Content`, `Select-String`, `Resolve-Path`, and explicit arrays.
Do not read `.env`, databases, logs, `node_modules`, `dist`, or `data`.

- [ ] **Step 3: Add the npm script and verify the first failure**

Add:

```json
"docs:check": "pwsh -NoProfile -File scripts/validate-docs.ps1"
```

Run:

```powershell
npm run docs:check
```

Expected: fail on missing or stale README links before README integration.

- [ ] **Step 4: Refactor `README.md` into the navigation hub**

Preserve the project identity and useful quick-start material. Add:

- verified capability and limitation summary;
- local Ollama-first and optional OpenAI/Tavily architecture;
- links to every root policy and detailed guide;
- four-command local quick start;
- Docker caveat for local Ollama host routing;
- command table for `/ask`, `/search`, `/forget`, `/help`, and `/status`;
- security summary;
- current release and proprietary license notice;
- documentation map.

Remove duplicated deep sections that are now authoritative elsewhere, but do not
remove instructions necessary for first-run success.

- [ ] **Step 5: Run the documentation validator and formatting**

Run:

```powershell
npm run docs:check
npx prettier --write README.md package.json scripts/validate-docs.ps1
npm run format:check
```

Expected: documentation validation and Prettier checks pass.

- [ ] **Step 6: Commit the validator and README**

```powershell
git add README.md package.json package-lock.json scripts/validate-docs.ps1
git commit -m "docs: integrate documentation hub and validation"
```

Expected: one commit containing the README, validator, and package metadata.

### Task 6: Full Verification and Security Review

**Files:**

- Review: all files changed since `origin/main`
- Modify: only files with verified defects

**Interfaces:**

- Consumes: complete documentation suite.
- Produces: a review-ready local branch with fresh verification evidence.

- [ ] **Step 1: Run the complete quality gate**

Run:

```powershell
npm run docs:check
npm test
npm run lint
npm run format:check
npm run build
```

Expected: documentation checks pass, all Vitest tests pass, ESLint reports no
errors, Prettier reports all files formatted, and TypeScript exits successfully.

- [ ] **Step 2: Run final secret and placeholder scans**

Run:

```powershell
$files = git diff --name-only origin/main...HEAD
$files | Select-String -Pattern 'sk-[A-Za-z0-9_-]{16,}|tvly-[A-Za-z0-9_-]{16,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|example@example|your@email|TBD|TODO|FIXME'
```

Expected: no matches.

- [ ] **Step 3: Review accuracy against the implementation**

Check:

```powershell
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
git status -sb
```

Confirm every documented command, environment key, file path, provider, security
control, limitation, and extension boundary has a matching implementation source
or is explicitly labeled as planned.

- [ ] **Step 4: Fix verified defects and rerun the full gate**

If any defect is found, edit only the affected documentation or validator, then
repeat Steps 1 through 3. Do not waive a failing check.

- [ ] **Step 5: Create a final review commit only if fixes were required**

```powershell
$reviewFixes = git diff --name-only
git add -- $reviewFixes
git commit -m "docs: correct documentation review findings"
```

Expected: no empty commit. If no defects were found, leave the prior commits as
the final branch state.

- [ ] **Step 6: Present the branch for user approval**

Report document inventory, commit list, verification results, known limitations,
and that the branch has not been pushed. Wait for explicit approval before
pushing or opening a pull request.
