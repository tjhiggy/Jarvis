# Command Deck confirm

The private Command Deck applies mutations only after an exact preview and a confirm. Confirm is idempotent for the same key, rejects a stale or cancelled preview, serializes in-flight confirms, and requires a second preview before rollback. This is local adapter state, not a live Sites publish.

## Sub-features

- `deck-preview` returns a private before/after diff and a preview id.
- `deck-confirm` applies the previewed action once and returns a receipt.
- `deck-stale` rejects confirm after the preview TTL and writes nothing.
- `deck-cancel` prevents confirm of a cancelled preview.
- `deck-inflight` serializes duplicate confirms and rejects a different in-flight idempotency key.
- `deck-retry` keeps a known failed confirm retryable with the same operation id.
- `deck-rollback` requires rollback preview and confirm, and fails if the target changed.

## How to get to it (user POV)

- An operator opens the private Sites Command Deck (or the localhost fallback) and chooses a mutation such as pause recap or remove an RSS feed.
- The Deck shows a preview. The operator confirms, cancels, retries, or rolls back.
- Jarvis applies the change on the local process. Sites is not published as part of this proof.

## Driving it with the Jarvis CI harness

Preconditions:

- Doctor has passed.
- `node_modules/.bin/vitest` exists.
- No Discord token and no Command Deck write token are in the environment.

- **Preview and stale confirm.** Run `npm test -- tests/command-deck-mutations.test.ts`. The tests `previews an exact, private before and after diff` and `rejects a stale preview without applying the action` must pass. `adapter.attempts` stays empty on stale confirm.
- **Cancel.** The test `cancels an unused preview and prevents confirmation` expects `PREVIEW_CANCELLED`.
- **In-flight and retry.** The tests `serializes duplicate confirmation and rejects a different in-flight idempotency key` and `keeps a known failed confirmation retryable with the same operation id` must pass.
- **Rollback.** The tests that require rollback preview/confirm and fail when the target changes must pass in the same file.
- **Driver.** Equivalent one-shot: `.cursor/skills/verify-jarvis/scripts/drive-feature.sh command-deck-confirm`.
- **Proof.** Exit code `0`. Artifact `.cursor/skills/verify-jarvis/artifacts/command-deck-confirm/verify.log` contains the confirm/cancel/rollback test names and a passing Vitest summary.

## Gotchas

- `npm run command-deck-cutover:verify` and `npm run command-deck-api:verify` are related CI gates. They do not replace this feature's confirm-state tests.
- Do not open a production Sites origin or post a real mutation. The adapter in this file is in-memory.
- Do not publish the Command Deck. This skill never runs a Sites deploy.
- Clock-sensitive cases use a injected `now` of `2026-08-23T12:00:00.000Z`. Do not rewrite those fixtures to `Date.now()` or they become date-tied.
