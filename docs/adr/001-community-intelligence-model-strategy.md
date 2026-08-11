# ADR 001: Community Intelligence model strategy

- Status: accepted for Jarvis 0.7
- Date: 2026-08-11

## Decision

Keep `gemma3:4b` as the default local Ollama model for Jarvis 0.7. Do not
promote `qwen3:4b`, and do not pull or run an 8B model on the current 16 GB
MuthaShip host during normal desktop operation.

Use deterministic application routes before the model for runtime identity,
approved knowledge, retained conversation search, Discord capability
boundaries, and current web information. Use Tavily-backed search for current
facts and the configured OpenAI provider only as an explicit operator-selected
cloud path. Offline behavior continues to use the themed maintenance response.

## Evidence

The checked-in synthetic evaluation contains five correctness, honesty,
safety, and concision cases. It stores only aggregate scores and latency, never
model responses or Discord content.

| Model     | Passed | Score | Average latency |
| --------- | ------ | ----- | --------------- |
| gemma3:4b | 3 / 5  | 13/15 | 5,687 ms        |
| qwen3:4b  | 2 / 5  | 12/15 | 9,689 ms        |

The host had about 3.74 GB free of 15.08 GB before the sequential run. An 8B
candidate would add memory pressure without evidence that it improves this
bounded workload. That is a lousy trade on a machine that also runs Discord,
ChatGPT Desktop, WSL, and Jarvis. Bigger is not automatically smarter.

## Consequences

- Jarvis 0.7 favors routing and grounding improvements over a riskier model
  swap.
- Both evaluated models remain locally installed, but only `gemma3:4b` is the
  recommended production default.
- The evaluation command unloads each model after use and emits aggregate JSON
  only.
- A future host with more available memory may reevaluate an 8B candidate using
  the same harness before promotion.

## Reproduction

```powershell
npm run build
npm run model:evaluate -- gemma3:4b
npm run model:evaluate -- qwen3:4b
```
