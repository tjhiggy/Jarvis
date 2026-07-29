# Concise Response and Search Routing Design

**Issue:** #77
**Status:** Approved design, not implemented

## Goal

Make ordinary conversation with Jarvis brief, direct, and in character without
mistaking casual words such as "today" for a request for current information.
Preserve detailed and grounded answers when the user asks for them or the
subject requires them.

## Scope

This release changes only response-style selection, trusted AI instructions,
automatic web-search routing, and their tests.

It does not add configuration, storage, Discord permissions, commands, message
deletion, server administration, external writes, or post-generation text
truncation.

## User experience

Casual prompts include greetings, thanks, jokes, emotional check-ins, and
ordinary small talk. Jarvis answers these directly in no more than three short
sentences and approximately 80 words. Muthaship personality remains present but
secondary to the answer.

Examples that must remain casual:

- `How are you feeling today?`
- `Hello Jarvis`
- `Thanks`
- `Tell me a joke`

Examples that must still use automatic grounding:

- `What is the weather today?`
- `What is the latest ARC Raiders update?`
- current prices, laws, schedules, scores, releases, and news

`/search` always forces grounding. Explicit requests for detail, such as
`explain in detail`, are not placed in the concise casual mode.

## Design

### Response-style classifier

Add a deterministic classifier that selects either `concise-casual` or
`standard`. It receives only the current normalized prompt and returns a
trusted enum. It does not call AI, inspect stored history, log prompt content,
or make authorization decisions.

Casual intent requires a recognized social form. The mere presence of `today`
does not establish freshness. Current-information signals such as weather,
news, schedules, releases, prices, laws, scores, or explicit search language
prevent casual classification.

Explicit detail language prevents concise classification even when the prompt
also contains a social phrase.

### Trusted response instructions

The conversation service appends a trusted response-style block to the existing
persona instructions. For `concise-casual`, the block requires:

- answer the user directly;
- use at most three short sentences and approximately 80 words;
- use Muthaship flavor sparingly;
- do not manufacture telemetry, diagnostics, or emotional evidence;
- do not add sources unless grounding was explicitly forced.

`standard` retains the existing behavior. The application does not truncate a
completed model response because that could damage code blocks, URLs, or safety
context.

### Search routing

Automatic search routing checks the casual classifier before generic freshness
signals. A casual prompt does not search merely because it contains `today`,
`currently`, or similar conversational wording.

Explicit `/search` remains authoritative and bypasses the casual exclusion.
Clearly current factual subjects continue to search automatically.

The response-style classifier and search router share one narrowly defined
casual-intent predicate so they cannot drift into contradictory decisions.

## Failure and safety behavior

Classification is local and deterministic, so it introduces no new outage
path. Unknown or ambiguous prompts use `standard` behavior. Existing provider,
search, evidence, logging, rate-limit, and safe-error behavior remains intact.

Prompt and response content stays out of operational logs. No content from
Discord or search results can alter the trusted response-style rules.

## Testing

Add table-driven classifier and routing tests covering:

- social prompts with `today` that must not search;
- greetings, thanks, and jokes;
- weather today, latest updates, prices, laws, schedules, and news that must
  search;
- forced `/search` on a casual prompt;
- explicit detail requests that retain standard style;
- conversation-service instructions for both response modes;
- absence of prompt content in operational logs.

Provider calls remain mocked. Tests require no real credentials or network.

## Rollout

Run the complete test, lint, formatting, build, and documentation gates. Deploy
only after review and merge. Validate in Discord with one casual prompt, one
forced search, and one clearly current automatic-search prompt. Roll back by
deploying the previous approved commit; no database or command-registration
change is required.
