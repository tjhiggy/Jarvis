# Concise Response Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep casual Jarvis conversations brief and prevent social uses of freshness words from triggering irrelevant web searches.

**Architecture:** Add one deterministic response-style classifier shared by automatic web-search routing and conversation instruction composition. Casual prompts receive a trusted, request-scoped concise instruction; clearly current, high-stakes, forced-search, and explicit-detail requests preserve existing behavior.

**Tech Stack:** TypeScript, Node.js, Vitest, existing OpenAI/Ollama adapters, existing Tavily grounding layer

## Global Constraints

- Casual replies use no more than three short sentences and approximately 80 words by trusted instruction, never blunt post-generation truncation.
- Explicit `/search` always forces grounding.
- Clearly current factual subjects such as weather, news, schedules, releases, prices, laws, and scores still ground automatically.
- Explicit detail requests remain in standard response mode.
- The classifier is deterministic, local, content-free in logs, and receives only the current normalized prompt.
- No configuration, storage, Discord permissions, commands, message deletion, server administration, or external writes.
- Existing provider, evidence, error, rate-limit, and logging behavior remains intact.

---

### Task 1: Shared casual-intent classifier and search-routing correction

**Files:**

- Create: `src/services/response-style.ts`
- Create: `tests/response-style.test.ts`
- Modify: `src/search/web-search.ts`
- Modify: `tests/web-search.test.ts`

**Interfaces:**

- Produces:

```ts
export type ResponseStyle = 'concise-casual' | 'standard';

export const classifyResponseStyle = (prompt: string): ResponseStyle;

export const isCasualConversationPrompt = (prompt: string): boolean;
```

- `requiresWebGrounding(prompt)` consumes `isCasualConversationPrompt()` after its existing supplied-text and fiction clause extraction, before generic freshness tests.

- [ ] Add table-driven failing classifier tests.

```ts
it.each([
  '- how are you feeling today?',
  'How are you feeling today?',
  'Hello Jarvis',
  'Thanks',
  'Tell me a joke',
])('classifies casual conversation: %s', (prompt) => {
  expect(classifyResponseStyle(prompt)).toBe('concise-casual');
});

it.each([
  'What is the weather today?',
  "What's the latest ARC Raiders update?",
  'What is the current Bitcoin price?',
  'Explain this in detail: how are you feeling today?',
])('keeps factual or detailed requests standard: %s', (prompt) => {
  expect(classifyResponseStyle(prompt)).toBe('standard');
});
```

- [ ] Run `npx vitest run tests/response-style.test.ts` and confirm the missing-module failure.

- [ ] Implement normalized matching with narrow positive social forms and explicit standard-mode exclusions.

```ts
export type ResponseStyle = 'concise-casual' | 'standard';

const detailSignal =
  /\b(?:explain|describe|walk me through|step by step|in detail|detailed|deep dive|comprehensive)\b/i;
const currentSubjectSignal =
  /\b(?:weather|forecast|news|price|cost|schedule|score|standings|law|legal|regulation|release|update|patch|version|event)\b/i;
const greetingSignal =
  /^(?:hey|hello|hi|good (?:morning|afternoon|evening))(?:\s+(?:jarvis|j\.?a\.?r\.?v\.?i\.?s\.?))?[!.?]*$/i;
const thanksSignal = /^(?:thanks|thank you|much appreciated)[!.?]*$/i;
const jokeSignal =
  /^(?:please\s+)?(?:tell|give)\s+me\s+(?:a|another)\s+joke[!.?]*$/i;
const emotionalCheckInSignal =
  /^(?:how are you|how are you feeling|how do you feel)(?:\s+(?:today|right now))?[!.?]*$/i;

export const isCasualConversationPrompt = (prompt: string): boolean => {
  const normalized = prompt
    .trim()
    .replace(/^[\s,.:;\-–—]+/u, '')
    .replace(/\s+/g, ' ');
  if (
    normalized === '' ||
    detailSignal.test(normalized) ||
    currentSubjectSignal.test(normalized)
  ) {
    return false;
  }
  return [
    greetingSignal,
    thanksSignal,
    jokeSignal,
    emotionalCheckInSignal,
  ].some((signal) => signal.test(normalized));
};

export const classifyResponseStyle = (prompt: string): ResponseStyle =>
  isCasualConversationPrompt(prompt) ? 'concise-casual' : 'standard';
```

- [ ] Add failing search-routing regressions showing casual prompts containing `today` return false while weather today and latest updates return true.

```ts
expect(requiresWebGrounding('How are you feeling today?')).toBe(false);
expect(requiresWebGrounding('What is the weather today?')).toBe(true);
expect(requiresWebGrounding("What's the latest ARC Raiders update?")).toBe(
  true,
);
```

- [ ] Add a service regression proving `webSearch: true` still invokes search for a casual prompt.

- [ ] Import `isCasualConversationPrompt` into `web-search.ts` and return false for recognized casual routing prompts before evaluating `explicitFreshnessSignal`.

- [ ] Run `npx vitest run tests/response-style.test.ts tests/web-search.test.ts`.

- [ ] Run lint, format check, and build.

- [ ] Commit with `feat: classify concise casual responses`.

### Task 2: Trusted concise instructions, documentation, and release verification

**Files:**

- Modify: `src/config/persona.ts`
- Modify: `src/services/conversation-service.ts`
- Modify: `tests/persona.test.ts`
- Modify: `tests/conversation-service.test.ts`
- Modify: `config/jarvis-persona.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/OPERATIONS.md`
- Modify: `docs/ROADMAP.md`

**Interfaces:**

- Consumes `ResponseStyle` and `classifyResponseStyle(prompt)` from Task 1.
- Changes instruction composition to:

```ts
export const composeInstructions = (
  persona: TrustedPersona,
  mode: PersonaMode,
  responseStyle?: ResponseStyle,
): string;
```

- Omitting `responseStyle` or passing `standard` preserves the current instruction text exactly.

- [ ] Add a failing persona test for the concise trusted block.

```ts
const instructions = composeInstructions(
  persona,
  'immersive',
  'concise-casual',
);
expect(instructions).toContain('Response style: concise casual conversation.');
expect(instructions).toContain(
  'Use no more than three short sentences and approximately 80 words.',
);
expect(instructions).toContain('Do not add sources');
expect(instructions).toContain(
  'Do not invent feelings, diagnostics, telemetry, or evidence.',
);
```

- [ ] Add a failing compatibility test proving standard instructions remain byte-for-byte identical when the third argument is omitted or equals `standard`.

- [ ] Implement the response-style instruction record and append only the `concise-casual` block.

```ts
const responseStyleInstructions: Readonly<
  Partial<Record<ResponseStyle, string>>
> = Object.freeze({
  'concise-casual': [
    'Response style: concise casual conversation.',
    'Answer the user directly.',
    'Use no more than three short sentences and approximately 80 words.',
    'Use MuthaShip flavor sparingly.',
    'Do not invent feelings, diagnostics, telemetry, or evidence.',
    'Do not add sources unless web grounding was explicitly forced.',
  ].join('\n'),
});
```

- [ ] Add a failing conversation-service test asserting `How are you feeling today?` reaches the mocked AI with concise instructions while `Explain in detail how AI works` receives standard instructions.

- [ ] Classify the normalized prompt once in `ConversationService.ask()` and pass the resulting style to `composeInstructions()`.

- [ ] Run the focused persona and conversation tests, then commit the code with `feat: apply concise response instructions`.

- [ ] Strengthen `config/jarvis-persona.md` so simple social answers lead with the answer, use flavor sparingly, and never turn casual prompts into fabricated diagnostics.

- [ ] Update documentation to explain concise casual routing, explicit-search behavior, the absence of post-generation truncation, and rollback. Move enhanced polls from roadmap `Next` to `Shipped`.

- [ ] Run focused tests:

```powershell
npx vitest run tests/response-style.test.ts tests/web-search.test.ts tests/persona.test.ts tests/conversation-service.test.ts
```

- [ ] Run the complete release gate:

```powershell
npm test
npm run lint
npm run format:check
npm run build
npm run docs:check
git diff --check
```

- [ ] Inspect `git status --short` and the branch diff for secrets, prompt or response logging, unrelated assets, new Discord permissions, new commands, storage changes, and post-generation truncation.

- [ ] Commit the documentation with `docs: document concise response routing`.

## Definition of Done

- `How are you feeling today?` does not trigger web search and receives the concise-casual trusted instruction.
- Greetings, thanks, jokes, and emotional check-ins use concise mode.
- Weather today, current prices, laws, schedules, scores, news, releases, and patches continue to ground automatically.
- `/search` still forces grounding for casual prompts.
- Explicit detail requests remain standard.
- No generated response is truncated after completion.
- All release gates pass.
- The branch is independently reviewed, pushed, and presented in a draft pull request for issue #77.
- Deployment remains separate and requires explicit approval after merge.
