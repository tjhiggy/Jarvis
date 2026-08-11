# Jarvis 0.7 Community Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Jarvis 0.7.0 with privacy-bounded knowledge retrieval, access-scoped retained-conversation search, opt-in member command statistics, controlled image generation, a measured model-routing decision, and Command Deck intelligence visibility.

**Architecture:** Existing SQLite repositories, Discord command routing, per-server feature flags, allowlists, and content-free platform metrics remain the platform foundation. New intelligence features operate only on administrator-approved catalog entries or already-retained Jarvis conversations, never silently ingest arbitrary Discord history. Paid or resource-heavy providers are disabled by default and require explicit configuration.

**Tech Stack:** TypeScript, Node.js 22+, Discord.js 14, SQLite/better-sqlite3, Zod, OpenAI SDK, Ollama HTTP API, Vitest, local Command Deck.

## Global Constraints

- Use MuthaShip/server/channel/crew in user-facing copy, never `guild`.
- No training or fine-tuning on Discord conversations.
- No privileged Discord intents, arbitrary history fetch, or cross-channel search.
- No message content, prompts, generated images, secrets, or member identities in logs or public evaluation artifacts.
- Every mutation is server-scoped, authorization-checked, bounded, feature-gated, and reversible.
- New behavior follows RED, GREEN, REFACTOR and ships only after the complete release gate.

---

### Task 1: Approved knowledge relevance and provenance

**Files:**

- Modify: `src/knowledge/approved-knowledge.ts`
- Modify: `src/commands/handlers.ts`
- Modify: `tests/approved-knowledge.test.ts`
- Modify: `docs/APPROVED_KNOWLEDGE.md`

**Interfaces:**

- Produces: `KnowledgeResult` with deterministic relevance and existing source attribution.
- Consumes: checked-in catalog plus per-server approval overrides.

- [x] Write failing tests proving multi-token relevance, approval/retention exclusion, source attribution, bounded results, and abstention.
- [x] Run `npm test -- --run tests/approved-knowledge.test.ts` and witness the intended failures.
- [x] Implement deterministic token scoring without embeddings or external calls; preserve the five-result cap and redaction.
- [x] Run the focused test and update the knowledge documentation.
- [x] Commit `feat: strengthen approved knowledge retrieval`.

### Task 2: Access-scoped retained-conversation search

**Files:**

- Create: `src/commands/server-search.ts`
- Modify: `src/commands/definitions.ts`
- Modify: `src/commands/handlers.ts`
- Create: `tests/server-search.test.ts`
- Modify: `tests/commands.test.ts`
- Modify: `tests/register-commands.test.ts`
- Modify: `README.md`
- Modify: `docs/SECURITY_MODEL.md`

**Interfaces:**

- Produces: `/server-search query:<text>` returning at most five timestamped matches from the current channel/thread's retained Jarvis conversation only.
- Consumes: existing `ConversationStore.history()` and current interaction context.

- [x] Write failing ranking, channel-isolation, mention-neutralization, result-cap, and unavailable-state tests.
- [x] Run the focused suite and witness missing-command/search failures.
- [x] Implement deterministic token relevance with no arbitrary Discord history fetch.
- [x] Register and route the command through the existing allowlist and private-response boundary.
- [x] Run focused tests and commit `feat: add scoped retained conversation search`.

### Task 3: Opt-in member command statistics

**Files:**

- Create: `src/community/member-statistics.ts`
- Modify: `src/commands/definitions.ts`
- Modify: `src/commands/handlers.ts`
- Modify: `src/platform/instrumentation.ts`
- Create: `tests/member-statistics.test.ts`
- Create: `tests/instrumentation-member-statistics.test.ts`
- Modify: `tests/application.test.ts`
- Modify: `docs/SECURITY_MODEL.md`

**Interfaces:**

- Produces: `/my-stats status|enable|disable` and server-scoped daily command counters for opted-in members.
- Consumes: command name, server ID, member ID, and event timestamp only.

- [x] Write failing storage/service tests for default opt-out, enable, daily counting, server isolation, disable-and-delete, retention, and safe output.
- [x] Witness failures before adding the isolated SQLite store and service.
- [x] Implement storage, service, command, instrumentation hook, and deletion path.
- [x] Run focused suites and commit `feat: add opt-in member command statistics`.

### Task 4: Controlled image generation

**Files:**

- Create: `src/images/image-generation.ts`
- Create: `src/openai/openai-image-service.ts`
- Modify: `src/config/config.ts`
- Modify: `.env.example`
- Modify: `src/commands/definitions.ts`
- Modify: `src/commands/handlers.ts`
- Modify: `src/index.ts`
- Create: `tests/image-generation.test.ts`
- Modify: `tests/config.test.ts`
- Modify: `docs/CONFIGURATION.md`
- Create: `docs/IMAGE_GENERATION.md`

**Interfaces:**

- Produces: administrator-only `/image generate prompt:<text>` in one configured allowlisted channel, one image per request, disabled by default.
- Consumes: `ImageGenerationService.generate({prompt})` returning bounded attachment bytes and media type.

- [x] Write failing tests for disabled default, admin/channel enforcement, prompt bounds, mention rejection, provider errors, one-image cap, and content-free logs.
- [x] Witness focused failures.
- [x] Implement the provider boundary and OpenAI image adapter with explicit model/configuration and timeout.
- [x] Wire Discord attachment delivery only after authorization; do not persist prompts or image bytes.
- [x] Run focused suites and commit `feat: add controlled image generation`.

### Task 5: Model evaluation and routing decision

**Files:**

- Create: `config/evaluations/jarvis-model-eval.json`
- Create: `scripts/evaluate-models.ts`
- Create: `src/evaluation/model-evaluation.ts`
- Create: `tests/model-evaluation.test.ts`
- Create: `docs/adr/ADR-0004-model-routing.md`
- Create: `docs/MODEL_EVALUATION.md`
- Modify: `package.json`
- Modify: `docs/CONFIGURATION.md`

**Interfaces:**

- Produces: deterministic prompt catalog, content-free aggregate result schema, and documented primary/fallback/cloud routing decision.
- Consumes: explicit model names supplied to a local evaluation command; never Discord data.

- [x] Write failing catalog validation, scoring, redaction, and aggregate-only report tests.
- [x] Implement the evaluation library and explicit local evaluation script.
- [x] Run baseline and candidate sequentially on the deployment workstation with unload between models.
- [x] Record aggregate results only and write an ADR with rollback guidance.
- [x] Commit `docs: record Jarvis model routing decision`.

### Task 6: Command Deck community intelligence view

**Files:**

- Modify: `src/admin/admin-console.ts`
- Modify: `src/index.ts`
- Modify: `tests/admin-console.test.ts`
- Modify: `docs/ADMIN_CONSOLE.md`
- Modify: `docs/COMMAND_SURFACE_MATRIX.md`

**Interfaces:**

- Produces: read-only intelligence card showing approved-source counts, scoped-search readiness, opt-in statistics totals, image-generation readiness, and active model identity.
- Consumes: aggregate/status projections only, never member IDs, prompts, source content, or conversation text.

- [ ] Write failing snapshot/HTML tests for healthy, disabled, and unavailable states with secret/content exclusion.
- [ ] Implement bounded projections and production wiring.
- [ ] Run focused tests and commit `feat: add community intelligence status to Command Deck`.

### Task 7: Jarvis 0.7.0 release

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/ROADMAP.md`
- Create: `docs/releases/v0.7.0.md`
- Modify: `tests/runtime-version.test.ts`

**Interfaces:**

- Produces: tagged, deployed, smoke-tested Jarvis 0.7.0 and closed milestone 5.
- Consumes: Tasks 1-6 and their migrations/configuration.

- [ ] Update version metadata, changelog, roadmap, release notes, configuration, migration/backup/rollback instructions, and smoke checklist.
- [ ] Run `npm test`, build, lint, format check, docs check, high-severity audit, and diff check.
- [ ] Review the complete release diff and correct every blocker.
- [ ] Open and merge reviewed PRs, create a stopped production backup, deploy one process, register commands, and run health/Discord/Command Deck smoke tests.
- [ ] Tag and publish `v0.7.0`, close issues 33, 34, 35, 42, and 194 with evidence, then close milestone 5.
