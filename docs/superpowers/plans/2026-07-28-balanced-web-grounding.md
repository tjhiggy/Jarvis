# Balanced Web Grounding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Jarvis automatically ground evidence-sensitive factual questions
without spending Tavily credits on ordinary definitions, drafting, or creative
conversation.

**Architecture:** Replace the freshness-only public routing predicate with a
balanced, named-signal `requiresWebGrounding()` policy in the existing search
service. Preserve Tavily caching and sanitization, then strengthen grounded
instructions so insufficient or merely adjacent evidence cannot become an
invented relationship.

**Tech Stack:** TypeScript, Node.js 22+, Tavily Search API, existing AI service
interfaces, Vitest, ESLint, Prettier

## Global Constraints

- The exact Kraft Singles and government-cheese question must automatically
  invoke search.
- Historical, government-program, named-entity relationship, statistical,
  quoted, scientific, medical, legal, and financial factual claims are
  evidence-sensitive.
- Basic definitions, supplied-text work, creative requests, drafting, and
  timeless coding help must avoid automatic search.
- Explicit `webSearch: true` always forces search.
- Search routing is a cost/evidence heuristic, never authorization.
- Preserve current Tavily cache, bounded results, prompt-injection defenses,
  model-link stripping, and deterministic source links.
- Empty evidence must produce an explicit inability to verify, never a guess.
- No new dependencies, environment variables, Discord permissions, or server
  settings.
- No secrets or private Discord content may enter tests or documentation.
- Do not push without explicit user approval.

---

### Task 1: Balanced Grounding Routing Policy

**Files:**

- Modify: `src/search/web-search.ts`
- Modify: `tests/web-search.test.ts`

**Interfaces:**

- Produces:
  `requiresWebGrounding(prompt: string): boolean`
- Consumes: normalized user prompt text only.
- Preserves: forced `AIRequest.webSearch`, `TavilySearchService`, and existing
  cache/sanitization behavior.

- [ ] **Step 1: Write failing must-search routing tests**

Add a table-driven test importing `requiresWebGrounding` with these prompts:

```ts
[
  'Tell us about Kraft American Singles and its relation to government cheese.',
  'What is the history of the USDA commodity cheese program?',
  'What is the relationship between OpenAI and Microsoft?',
  'What percentage of Americans used SNAP in 2025?',
  'Who said "The future is already here" and when?',
  'Is this medication safe during pregnancy?',
  'What law governs this contract?',
  'Is this investment federally insured?',
  'Does creatine improve strength according to research?',
  "What's the latest ARC Raiders update?",
];
```

Assert every prompt returns `true`.

- [ ] **Step 2: Run the must-search test and verify RED**

Run:

```powershell
npm test -- --run tests/web-search.test.ts
```

Expected: the new routing assertions fail because
`requiresWebGrounding` does not exist or evidence-sensitive timeless prompts
return false.

- [ ] **Step 3: Write failing must-not-search routing tests**

Add a table-driven test with:

```ts
[
  'What is RAM?',
  'Write a MuthaShip short story.',
  'Rewrite this announcement: Game night starts at eight.',
  'Draft a repository README.',
  'How do I reverse an array in TypeScript?',
  'Summarize this supplied text: The engine is offline.',
  'Create a Discord server setup checklist.',
];
```

Assert every prompt returns `false`.

- [ ] **Step 4: Implement named grounding signals and exclusions**

In `src/search/web-search.ts`, add small constants or helper predicates for:

- explicit freshness and release information;
- history and origin questions;
- government, law, regulation, and public-program questions;
- named-entity relationship language;
- dated statistics, prices, rankings, and quotations;
- medical, legal, financial, and evidence-dependent scientific claims;
- drafting, creative, supplied-text, basic-definition, and timeless-code
  exclusions.

Export:

```ts
export const requiresWebGrounding = (prompt: string): boolean;
```

Use exclusions only when they clearly describe the entire request. Do not let a
creative prefix suppress an embedded request for current facts.

- [ ] **Step 5: Switch service routing to the balanced policy**

Replace:

```ts
!requiresCurrentInformation(request.prompt);
```

with:

```ts
!requiresWebGrounding(request.prompt);
```

Keep `request.webSearch === true` as the first forced-search override.

- [ ] **Step 6: Run targeted tests and refactor while green**

Run:

```powershell
npm test -- --run tests/web-search.test.ts
```

Expected: all web-search tests pass. Refactor repeated regex fragments into
named signals without changing test outcomes.

- [ ] **Step 7: Commit routing policy**

```powershell
git add src/search/web-search.ts tests/web-search.test.ts
git commit -m "feat(search): ground evidence-sensitive questions"
```

### Task 2: Evidence Discipline and Failure Behavior

**Files:**

- Modify: `src/search/web-search.ts`
- Modify: `tests/web-search.test.ts`

**Interfaces:**

- Consumes: `requiresWebGrounding()` and sanitized `SearchResult[]`.
- Produces: grounded AI requests with immutable evidence rules and deterministic
  source links.

- [ ] **Step 1: Write a failing Kraft regression service test**

Construct `WebGroundedAIService` with a search spy. Ask the exact Kraft question
without `webSearch: true`. Assert:

- the search spy receives the exact prompt;
- the AI prompt contains returned Kraft and USDA evidence;
- the AI instructions contain a rule forbidding relationships inferred from
  co-occurrence or similarity.

- [ ] **Step 2: Run the Kraft regression test and verify RED**

Run:

```powershell
npm test -- --run tests/web-search.test.ts
```

Expected: failure because the new relationship-evidence instruction is absent.

- [ ] **Step 3: Strengthen grounded evidence instructions**

Add immutable instructions requiring:

- official and primary sources when available;
- sourced fact versus inference separation;
- no relationship claim based only on co-occurrence or similarity;
- explicit qualification for conflicting or incomplete evidence;
- no unsupported factual completion.

- [ ] **Step 4: Write and verify empty-evidence behavior**

Add a test where search returns no results for the Kraft prompt. Assert the AI
request contains:

```text
No usable sources verified the requested facts or relationship. State that
verified intelligence is unavailable and do not guess or infer a connection.
```

Run the test before implementation and confirm it fails on the old generic
message, then update the empty-result prompt minimally.

- [ ] **Step 5: Preserve forced search and link safety**

Retain or expand tests proving:

- `webSearch: true` searches even for “What is RAM?”;
- model-invented URLs are stripped;
- only sanitized Tavily links appear in `Sources`;
- search-result instructions cannot override system rules.

- [ ] **Step 6: Run targeted tests and commit**

Run:

```powershell
npm test -- --run tests/web-search.test.ts
```

Expected: all tests pass.

Commit:

```powershell
git add src/search/web-search.ts tests/web-search.test.ts
git commit -m "fix(search): require evidence for factual relationships"
```

### Task 3: Documentation and Release Notes

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/CONFIGURATION.md`
- Modify: `docs/SECURITY_MODEL.md`

**Interfaces:**

- Consumes: final routing categories and grounded-response behavior from Tasks
  1 and 2.
- Produces: source-backed operator and contributor guidance.

- [ ] **Step 1: Update the README capability and cost explanation**

Document that automatic Tavily grounding covers current information and
evidence-sensitive factual claims, including history, government programs,
named-entity relationships, statistics, and high-stakes domains. Explain that
basic definitions and drafting normally remain local to conserve credits and
latency.

- [ ] **Step 2: Update detailed technical guides**

In `docs/ARCHITECTURE.md`, update the request flow and search-routing boundary.

In `docs/CONFIGURATION.md`, explain that configuring `TAVILY_API_KEY` enables
balanced automatic grounding and that each uncached automatic search consumes
provider usage.

In `docs/SECURITY_MODEL.md`, state that:

- routing is heuristic, not authorization or a fact guarantee;
- the full normalized prompt leaves the process when search runs;
- search evidence is untrusted and bounded;
- empty evidence produces an inability-to-verify instruction.

- [ ] **Step 3: Update the changelog**

Under `Unreleased`, add the balanced-grounding policy and relationship
anti-hallucination behavior.

- [ ] **Step 4: Validate documentation**

Run:

```powershell
npm run docs:check
npx prettier --check README.md CHANGELOG.md docs/ARCHITECTURE.md docs/CONFIGURATION.md docs/SECURITY_MODEL.md
git diff --check
```

Expected: all commands pass.

- [ ] **Step 5: Commit documentation**

```powershell
git add README.md CHANGELOG.md docs/ARCHITECTURE.md docs/CONFIGURATION.md docs/SECURITY_MODEL.md
git commit -m "docs: explain balanced automatic grounding"
```

### Task 4: Full Verification and Review

**Files:**

- Review: all files changed from the branch base.
- Modify: only files with verified defects.

**Interfaces:**

- Consumes: completed feature and documentation.
- Produces: a review-ready, unpushed branch.

- [ ] **Step 1: Run full quality gate**

```powershell
npm run docs:check
npm test
npm run lint
npm run format:check
npm run build
git diff --check
```

Expected: documentation validation passes, all Vitest tests pass, ESLint and
Prettier report no errors, TypeScript builds, and the diff is clean.

- [ ] **Step 2: Run targeted routing probes**

Use the exported `requiresWebGrounding()` in a short TypeScript or Vitest probe
to confirm:

- the exact Kraft prompt returns true;
- “What is RAM?” returns false;
- drafting and creative prompts return false;
- forced `webSearch: true` still invokes search.

- [ ] **Step 3: Review cost and false-positive boundaries**

Inspect each must-search and must-not-search category. Confirm exclusions cannot
silence embedded explicit freshness or relationship requests. Confirm no
Discord permissions, environment variables, or dependencies changed.

- [ ] **Step 4: Review security boundaries**

Confirm:

- full prompt egress is documented;
- search-result injection defenses remain intact;
- model-invented links remain stripped;
- the routing heuristic cannot grant capabilities or authority;
- no credentials or private message contents entered fixtures.

- [ ] **Step 5: Fix verified defects and rerun the complete gate**

If review finds a defect, write a failing regression test first, confirm RED,
make the minimal fix, then rerun Steps 1 through 4.

- [ ] **Step 6: Present for user approval**

Report commits, changed files, routing examples, Tavily cost behavior, test
counts, remaining limitations, and that no push occurred. Wait for explicit
approval before pushing.
