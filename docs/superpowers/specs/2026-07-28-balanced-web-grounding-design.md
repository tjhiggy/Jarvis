# Balanced Web Grounding Design

## Purpose

Prevent Jarvis from answering evidence-sensitive factual questions with
confident but unsupported model output. Expand automatic Tavily grounding beyond
freshness questions while preserving low latency and search credits for ordinary
conversation, drafting, and basic timeless explanations.

The motivating regression is:

> Tell us about Kraft American Singles and its relation to government cheese.

Jarvis must search for evidence before answering that question. It must not
invent a connection among Kraft Singles, USDA commodity cheese, and SNAP.

## Selected Approach

Replace the freshness-only `requiresCurrentInformation()` decision with a
balanced `requiresWebGrounding()` policy.

Ground a prompt when it explicitly requests web search or contains a strong
signal from at least one evidence-sensitive category:

1. Current or changing information.
2. Historical origins, events, timelines, or causation.
3. Government programs, laws, regulations, public policy, or official actions.
4. Relationships among named products, companies, people, organizations, or
   institutions.
5. Statistics, prices, dates, rankings, quotations, or attributed claims.
6. Medical, legal, or financial factual guidance.
7. Scientific or technical claims whose correctness materially depends on
   evidence rather than a basic definition.

Do not ground prompts that are clearly:

- casual conversation;
- creative writing, rewriting, brainstorming, or drafting;
- requests for code that do not depend on current versions or external facts;
- basic timeless definitions such as “What is RAM?”;
- requests that can be answered from supplied text or conversation context
  without introducing external factual claims.

The classifier is a cost and evidence-routing heuristic, not a security or
authorization boundary.

## Components

### Grounding decision

`src/search/web-search.ts` will export:

```ts
export const requiresWebGrounding = (prompt: string): boolean;
```

The function will use small, named signal groups and explicit exclusions rather
than one giant opaque regular expression. The existing freshness cases remain
supported. `requiresCurrentInformation` will be removed or retained only as an
internal helper, not as the public routing policy.

The policy must recognize the exact Kraft/government-cheese regression, generic
“relationship between X and Y” questions, government-program history, dated
statistics, attributed quotations, and high-stakes factual categories.

### Grounded response instructions

`WebGroundedAIService` will keep existing search-result prompt-injection
protections and deterministic source links. Its evidence instructions will also
require the model to:

- prefer official and primary sources when available;
- distinguish sourced facts from inference;
- avoid inferring relationships from mere co-occurrence or similarity;
- state when sources conflict or do not establish the requested relationship;
- say that verified intelligence is unavailable when no usable sources are
  returned.

The service will continue stripping model-invented URLs and appending only
sanitized Tavily source URLs.

### Search query

The initial implementation will send the normalized user prompt as the Tavily
query, preserving current cache behavior and avoiding a second model call for
query rewriting. Query rewriting is deliberately deferred until evidence shows
that raw prompts produce poor retrieval.

## Data Flow

1. Conversation handling accepts and normalizes the untrusted prompt.
2. The unsupported-action classifier may return a local limitation response.
3. The selected AI service receives an answerable prompt.
4. `WebGroundedAIService` searches when `webSearch` is forced or
   `requiresWebGrounding(prompt)` returns true.
5. Tavily returns bounded, sanitized evidence.
6. The model receives the prompt, evidence, current date, and immutable evidence
   rules.
7. Jarvis returns the answer plus deterministic source links.
8. If no sources survive sanitization, Jarvis receives a strict no-evidence
   instruction and must not guess.

## Error Handling

- Tavily transport, timeout, and service errors continue through the existing
  AI-service error mapping and safe Discord error response.
- An empty sanitized result set is not treated as provider success. The model
  may answer only with an explicit inability to verify the requested facts.
- Conflicting or incomplete sources must produce qualified language, not an
  invented synthesis.
- Search results remain untrusted data and cannot modify instructions or enable
  capabilities.

## Tests

Add table-driven routing tests for prompts that must search:

- the exact Kraft Singles and government-cheese question;
- the history of a government commodity program;
- the relationship between two named organizations or products;
- a request for a dated statistic or attributed quotation;
- medical, legal, financial, and scientific factual claims;
- existing freshness and release-update cases.

Add routing tests for prompts that must not search:

- “What is RAM?”;
- a creative story request;
- rewriting a supplied announcement;
- drafting a repository README;
- timeless coding help;
- summarizing supplied text.

Add service tests verifying:

- the Kraft regression triggers search;
- evidence instructions prohibit unsupported relationship inference;
- empty results instruct the model to admit that verification failed;
- explicit `webSearch: true` still overrides normal exclusions;
- verified source links remain deterministic and model-invented URLs are
  removed.

## Documentation

Update `README.md`, `docs/ARCHITECTURE.md`, `docs/CONFIGURATION.md`,
`docs/SECURITY_MODEL.md`, and `CHANGELOG.md` to describe balanced automatic
grounding, its cost and latency tradeoff, Tavily prompt egress, and the fact that
the routing classifier is heuristic.

No new environment variables or dependencies are required.

## Non-Goals

- Fact-checking every sentence produced by the model.
- Searching every factual or definitional question.
- Training or fine-tuning Ollama from Discord conversations.
- Adding a second model call to rewrite search queries.
- Implementing semantic classification, embeddings, or a rules administration
  interface.
- Changing Discord permissions, intents, or server settings.

## Acceptance Criteria

- The Kraft/government-cheese prompt automatically invokes Tavily.
- The model is explicitly forbidden from inventing an unsupported relationship.
- Empty or insufficient results produce an honest limitation instead of a
  guessed answer.
- Basic definitions and creative/drafting requests do not consume search
  credits.
- Existing forced-search, caching, source sanitization, URL stripping, and
  prompt-injection protections continue to pass.
- Documentation, tests, linting, formatting, and TypeScript build all pass.
