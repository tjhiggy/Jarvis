# Jarvis Project Documentation Suite Design

## Purpose

Create a complete, maintainers-first documentation set for MuthaShip Jarvis. The
documentation must explain the software that exists today, support safe operation
and contribution, and establish clear boundaries for security, licensing, and
future extensions.

The suite must remain useful to three audiences:

1. Discord administrators deploying Jarvis.
2. Developers maintaining or extending the TypeScript project.
3. Operators diagnosing the native Windows, Ollama, Tavily, SQLite, or Docker
   runtime.

## Chosen Approach

Use a complete operational documentation set rather than a minimal repository
shell or an enterprise governance library. Each document must have a distinct
job, avoid repeating large sections from the README, and link readers to the next
relevant source.

Jarvis remains proprietary and all rights reserved. Publishing source code does
not grant permission to copy, modify, redistribute, sublicense, or use it
commercially.

## Deliverables

### Repository-level documents

- `README.md`: concise project entrance, capabilities, quick start, navigation,
  current limitations, and extension overview.
- `CHANGELOG.md`: Keep a Changelog structure beginning with the existing
  `v0.1.0` release.
- `CONTRIBUTING.md`: development workflow, branch and commit expectations,
  verification commands, testing expectations, and safe contribution boundaries.
- `SECURITY.md`: supported version policy, private vulnerability reporting,
  credential handling, and response expectations.
- `SUPPORT.md`: supported questions, diagnostic information to provide, and
  boundaries between support and security reports.
- `CODE_OF_CONDUCT.md`: Contributor Covenant-based community expectations with a
  project-specific enforcement contact that does not invent an email address.
- `LICENSE.md`: explicit proprietary, all-rights-reserved notice.

### Detailed guides

- `docs/ARCHITECTURE.md`: runtime components, request flow, trust boundaries,
  storage model, and extension interfaces.
- `docs/CONFIGURATION.md`: every supported environment variable, validation
  behavior, safe examples, and provider-specific settings.
- `docs/DISCORD_SETUP.md`: application creation, bot setup, intents, minimum
  permissions, invitation URL template, command registration, and private-bot
  considerations.
- `docs/DEVELOPMENT.md`: prerequisites, installation, local workflow, tests,
  linting, formatting, builds, mocks, and repository layout.
- `docs/DEPLOYMENT.md`: native Windows operation, scheduled-task behavior,
  Docker deployment, persistent storage, upgrades, and rollback guidance.
- `docs/OPERATIONS.md`: startup, shutdown, health checks, logs, backups,
  conversation cleanup, resource controls, and outage behavior.
- `docs/TROUBLESHOOTING.md`: symptom-based diagnosis for Discord, Ollama,
  OpenAI, Tavily, SQLite, slash-command registration, and memory pressure.
- `docs/SECURITY_MODEL.md`: assets, trust boundaries, implemented protections,
  prohibited capabilities, known risks, and hardening backlog.
- `docs/RELEASES.md`: versioning, release checklist, tagging, validation, and
  rollback procedure.
- `docs/ROADMAP.md`: implemented foundation, near-term improvements, and
  explicitly unimplemented extension points.
- `docs/extensions/README.md`: contracts and safe next steps for GitHub
  read-only tools, MCP, repository analysis, pull-request summaries, recaps,
  gaming scores, image generation, and administrator-only commands.

### GitHub repository metadata

- `.github/ISSUE_TEMPLATE/bug_report.yml`: structured bug intake without secret
  fields.
- `.github/ISSUE_TEMPLATE/feature_request.yml`: problem-first feature requests
  with security-impact prompts.
- `.github/ISSUE_TEMPLATE/config.yml`: disables blank issues and links users to
  support and security guidance.
- `.github/pull_request_template.md`: scope, validation, security, documentation,
  and breaking-change checklist.
- `.github/dependabot.yml`: conservative monthly npm and GitHub Actions update
  checks with bounded pull-request volume.

## Content Boundaries

- Describe only behavior verified in source, tests, configuration, or current
  operating scripts.
- Never copy local secret values, Discord IDs, API keys, database contents,
  private invite codes, or private machine-specific logs into documentation.
- Use placeholders for credentials and identifiers, clearly labeled as examples.
- Do not document Jarvis as capable of executing code, changing repositories,
  administering Discord, or writing to GitHub. Those abilities are not
  implemented and remain prohibited by default.
- Explain that per-channel conversation history is contextual memory, not model
  training or autonomous learning.
- Identify Tavily search as optional external data retrieval and Ollama as the
  current local-first inference path.
- Preserve the MuthaShip theme in examples sparingly. Operational instructions
  must favor clarity over roleplay.

## Information Architecture

The README is the navigation hub. It links to detailed guides instead of
duplicating them. Detailed guides cross-link only where a reader must change
domains, such as moving from Discord configuration to deployment.

Architecture documentation will use one Mermaid request-flow diagram because the
relationship among Discord, request controls, storage, search, and the AI
provider is materially clearer visually. Other documents use prose, tables, and
short command examples.

## Verification

The documentation pass is complete only when:

1. `npm test`, `npm run lint`, `npm run format:check`, and `npm run build` pass.
2. Every relative Markdown link resolves to an existing repository file or
   heading.
3. No unfinished placeholder markers or dummy contact addresses remain.
4. A secret-pattern scan finds no likely Discord, OpenAI, Tavily, or private-key
   material in tracked documentation.
5. Environment-variable documentation matches `src/config/config.ts` and
   `.env.example`.
6. Command documentation matches `src/commands/definitions.ts` and package
   scripts match `package.json`.
7. GitHub YAML templates parse successfully.

## Delivery and Git Strategy

Develop the suite on `codex/documentation-suite`. Commit the approved design
separately from the implementation so its scope remains auditable. After the
documentation implementation passes verification, create a second local commit
and present the result for review. Do not push the branch or open a pull request
without explicit user approval.
