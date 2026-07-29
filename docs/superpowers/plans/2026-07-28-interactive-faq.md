# Interactive Jarvis FAQ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public, read-only `/faq` command that returns approved Jarvis information from a validated, version-controlled catalog without using AI, web search, SQLite, or Discord administration capabilities.

**Architecture:** A strict catalog loader turns `config/faq.json` into an immutable `FaqCatalog` at startup and command-registration time. The catalog is injected into command definitions and handlers. Discord submits only registered topic IDs, while the handler still performs an exact defensive lookup and uses the existing safe delivery boundary.

**Tech Stack:** TypeScript, Node.js 22+, discord.js REST command registration, Zod, Vitest, ESLint, Prettier

## Global Constraints

- Preserve the approved design in `docs/superpowers/specs/2026-07-28-interactive-faq-design.md`.
- Do not add Discord intents, permissions, components, collectors, admin actions, file writes, dynamic evaluation, AI calls, web calls, or database writes.
- Never accept a filesystem path from Discord input.
- Never log the catalog path, catalog content, or user input.
- Keep replies public for valid FAQ listing, answers, and unknown topics. Keep existing DM and allowlist rejections ephemeral.
- Use the existing `replySafely` path so mass mentions remain neutralized and uncontrolled mentions remain disabled.
- Keep `assets/jarvis-admin-overview-infographic.png` untouched because it is unrelated untracked user work.
- Follow test-driven development: write the failing test, run it, implement the minimum change, rerun it, then commit the bounded task.

---

## Task 1: Build and validate the immutable FAQ catalog

**Files:**

- Create: `src/faq/faq-catalog.ts`
- Create: `config/faq.json`
- Create: `tests/faq-catalog.test.ts`

- [ ] Write `tests/faq-catalog.test.ts` using a temporary directory and real UTF-8 JSON files. Cover a valid nine-entry catalog, case-insensitive lookup, frozen root/catalog entries, and defensive behavior for unknown IDs.
- [ ] Add table-driven rejection tests for non-array roots, zero and 26 entries, non-object entries, unknown or missing fields, non-string fields, leading/trailing whitespace, duplicate case-normalized IDs, invalid ID characters or lengths, field length limits, NUL, U+2028, and U+2029.
- [ ] Assert every loader failure exposes only `Invalid FAQ catalog configuration: FAQ_CATALOG_PATH` and never includes the temporary path, answer text, parser detail, or file contents.
- [ ] Run `npx vitest run tests/faq-catalog.test.ts` and confirm failure because the loader does not exist.
- [ ] Implement and export:

```ts
export interface FaqEntry {
  readonly id: string;
  readonly label: string;
  readonly question: string;
  readonly answer: string;
}

export interface FaqCatalog {
  readonly entries: readonly FaqEntry[];
  get(id: string): FaqEntry | undefined;
}

export const loadFaqCatalog = async (path: string): Promise<FaqCatalog> => {};
```

- [ ] Use `readFile(path, 'utf8')`, `JSON.parse`, and a strict Zod schema. Enforce 1 to 25 entries, exact keys, the approved field limits, lowercase `[a-z0-9-]+` IDs, trimmed values, prohibited control separators, and duplicate IDs after lowercase normalization.
- [ ] Construct a private lookup map, freeze each copied entry and the entries array, and expose only a frozen catalog object whose `get` normalizes the supplied ID with `trim().toLowerCase()`.
- [ ] Add the approved nine Jarvis-only entries to `config/faq.json`. Keep copy factual, concise, Muthaship-themed, and explicit that Jarvis cannot modify Discord or operate while the local Shipboard Core is offline.
- [ ] Run `npx vitest run tests/faq-catalog.test.ts`, then `npm run lint` and `npm run format:check`.
- [ ] Commit with `feat: add validated Jarvis FAQ catalog`.

## Task 2: Add FAQ catalog configuration

**Files:**

- Modify: `src/config/config.ts`
- Modify: `.env.example`
- Modify: `tests/config.test.ts`

- [ ] Add failing configuration tests that verify `FAQ_CATALOG_PATH` defaults to `./config/faq.json`, accepts a non-empty override, is exposed under `config.faq.catalogPath`, and is available from `loadDiscordRegistrationConfig`.
- [ ] Run `npx vitest run tests/config.test.ts` and confirm the new assertions fail.
- [ ] Extend `AppConfig` with:

```ts
readonly faq: Readonly<{
  catalogPath: string;
}>;
```

- [ ] Extend `DiscordRegistrationConfig` with `faqCatalogPath`, add `FAQ_CATALOG_PATH: optionalString('./config/faq.json')` to the base environment schema, return it from both loaders, and keep the existing sanitized variable-name-only validation format.
- [ ] Document `FAQ_CATALOG_PATH=./config/faq.json` in `.env.example`.
- [ ] Run `npx vitest run tests/config.test.ts`, then `npm run lint` and `npm run format:check`.
- [ ] Commit with `feat: configure FAQ catalog path`.

## Task 3: Register `/faq` from the validated catalog

**Files:**

- Modify: `src/commands/definitions.ts`
- Modify: `scripts/register-commands.ts`
- Modify: `tests/commands.test.ts`
- Modify: `tests/register-commands.test.ts`

- [ ] Add failing command-definition tests for a sixth command named `faq`, one optional string option named `topic`, entry labels as choice names, entry IDs as values, and a valid 25-choice boundary.
- [ ] Add failing validation tests proving `createCommandDefinitions` rejects zero or more than 25 FAQ choices even if a caller bypasses the file loader.
- [ ] Refactor the command option types into a discriminated union. Keep required bounded `prompt` and `query` options, and add:

```ts
interface FaqTopicOptionDefinition {
  readonly type: 3;
  readonly name: 'topic';
  readonly description: string;
  readonly required: false;
  readonly choices: readonly {
    readonly name: string;
    readonly value: string;
  }[];
}
```

- [ ] Change the factory signature to `createCommandDefinitions(maxInputChars, faqEntries)` and build choices solely from validated `FaqEntry` label and ID values.
- [ ] Add a failing registration test with an injected `loadFaqCatalog` dependency. Assert the configured path is loaded before REST `put`, the payload includes `/faq`, and no OpenAI or Tavily setting is needed.
- [ ] Update `registerCommands` dependencies so tests can inject the loader. In production, load `config.faqCatalogPath`, pass `catalog.entries` to `createCommandDefinitions`, and retain the existing generic `Command registration failed.` terminal error.
- [ ] Run `npx vitest run tests/commands.test.ts tests/register-commands.test.ts`, then lint and format checks.
- [ ] Commit with `feat: register catalog-backed FAQ command`.

## Task 4: Implement the public, read-only FAQ handler

**Files:**

- Modify: `src/commands/handlers.ts`
- Modify: `tests/commands.test.ts`

- [ ] Extend the test interaction helper so `options.getString('topic')` returns an optional topic ID.
- [ ] Add failing tests for exact public answers, omitted-topic public listings, public unknown-topic guidance, DM rejection, direct channel allowlist rejection, parent-thread allowlist acceptance, and mass-mention neutralization in catalog answers.
- [ ] In every FAQ test, use spies that throw if `conversationService.ask`, `conversationService.clear`, or `store.healthCheck` is called. This proves `/faq` has no AI, web, history, or diagnostic side effects.
- [ ] Add `faq: FaqCatalog` to `CommandDependencies`, add `faq` to the command switch, and implement a local `handleFaq` function.
- [ ] Reuse the exact `rejectDirectMessage`, `isAllowedChannel`, `threadParentId`, and `replySafely` boundaries. Do not defer.
- [ ] When no topic is supplied, reply with a concise instruction followed by the catalog questions. When the exact lookup misses, reply publicly with safe valid-topic guidance. When it matches, return only the approved answer.
- [ ] Add `/faq` to `/help`, and add `FAQ catalog: loaded` to `/status` without exposing the path or content.
- [ ] Run `npx vitest run tests/commands.test.ts`, then lint and format checks.
- [ ] Commit with `feat: answer approved Jarvis FAQs`.

## Task 5: Load the catalog before Discord login and inject it

**Files:**

- Modify: `src/index.ts`
- Modify: `tests/application.test.ts`

- [ ] Add `faq: { catalogPath: 'faq.json' }` to the shared test `AppConfig`.
- [ ] Add an injectable `loadFaqCatalog` dependency to `ApplicationDependencies`, defaulting to the production loader.
- [ ] Add a failing startup-order test that records catalog load and Discord login, asserts the configured path is passed, and proves load completes before login.
- [ ] Add a failing startup test where catalog loading rejects with a sanitized FAQ configuration error. Assert Discord login never runs, already-created resources close once, exit code becomes 1, and `reportStartupFailure` may print only the sanctioned `FAQ_CATALOG_PATH` message.
- [ ] Load the catalog immediately after the trusted persona and before store/AI/client startup where practical. Pass it into `handleCommand` through dependency injection.
- [ ] Preserve the existing shutdown idempotency and sanitized operational telemetry.
- [ ] Run `npx vitest run tests/application.test.ts tests/commands.test.ts`, then lint and format checks.
- [ ] Commit with `feat: load FAQ catalog during startup`.

## Task 6: Document, verify, and prepare the release

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/SECURITY.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `Dockerfile` only if its existing copy rules do not already include `config/faq.json`
- Modify: `docker-compose.yml` only if documentation or a read-only path override is needed

- [ ] Update README command examples and user experience for `/faq`, explain that answers are approved local content and cost nothing, document `FAQ_CATALOG_PATH`, and state that command registration must run after deployment.
- [ ] Update architecture and security docs with the catalog trust boundary, no provider/storage side effects, read-only behavior, 25-topic cap, and sanitized startup failure.
- [ ] Update operations and troubleshooting docs with catalog validation failures, development-guild registration, live checks, and rollback by deploying the previous version and re-registering its command set.
- [ ] Add an Unreleased changelog entry.
- [ ] Inspect Docker copy rules. Change them only if the image would otherwise omit `config/faq.json`; do not make the catalog a Discord-writable volume.
- [ ] Run the focused suite:

```powershell
npx vitest run tests/faq-catalog.test.ts tests/config.test.ts tests/commands.test.ts tests/register-commands.test.ts tests/application.test.ts
```

- [ ] Run the complete release gate and require every command to exit successfully:

```powershell
npm test
npm run lint
npm run format:check
npm run build
npm run docs:check
```

- [ ] Review `git diff --check`, `git status --short`, and `git diff --stat`. Confirm no secrets, absolute local paths, unrelated infographic changes, or new Discord privileges are present.
- [ ] Commit documentation and final integration with `docs: document interactive FAQ operations`.
- [ ] Push `codex/interactive-faq`, create a pull request against `main`, and report the URL.
- [ ] After deployment, run `npm run register-commands` once, then manually verify `/faq`, one selected answer, omitted-topic listing, a disallowed-channel attempt, and `/status`.

## Definition of Done

- `/faq` is visible in the development guild with 1 to 25 approved topic choices.
- Valid answers and listings are public, safe from uncontrolled mentions, and match checked-in content exactly.
- DM and disallowed-channel requests are rejected through existing safe boundaries.
- The feature performs no AI, Tavily, SQLite, or Discord mutation operation.
- Missing or invalid catalogs prevent startup and registration without leaking paths or content.
- Help, status, configuration, Docker packaging, and operator docs match the implemented behavior.
- Tests, lint, formatting, TypeScript build, and documentation validation all pass.
- Changes are committed, pushed, and presented in a pull request. The unrelated infographic remains untouched.
