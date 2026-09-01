# Delegated posts Sent by

Administrators draft a MuthaShip transmission with `/post preview` and publish it with `/post confirm`. The posted card is titled `MuthaShip transmission` and includes a `Sent by` field with the requesting member's display name. Mentions are neutralized. This is not a Discord system message.

## Sub-features

- `post-preview` shows a private preview (`Review MuthaShip transmission`) and does not post yet.
- `post-confirm-sent-by` posts one card whose embed fields include `{ name: 'Sent by', value: <ownerName> }`.
- `post-duplicate` rejects a second preview of the same draft and rejects a second confirm.
- `post-mention-neutralize` stores `@everyone` in a zero-width form so the card cannot mass-mention.
- `post-missing-guild` uses the configured guild when the interaction omits `guildId`.

## How to get to it (user POV)

- A configured administrator runs `/post preview` in an allowlisted server.
- The same administrator runs `/post confirm` with the draft id, or uses the preview buttons.
- Crew members see the public `MuthaShip transmission` card in the configured test/activity channel.

## Driving it with the Jarvis CI harness

Preconditions:

- Doctor has passed.
- `node_modules/.bin/vitest` exists.
- No Discord token is in the environment.

- **Configured preview and confirm.** Run `npm test -- tests/delegated-posts.test.ts`. The test `previews and confirms for a guild interaction when channel and admin roles are configured` expects an ephemeral preview, then an ephemeral "transmission posted to the test channel" reply, `sent` length `1`, title `MuthaShip transmission`, and a field named `Sent by`.
- **Missing guild id.** The test `previews and confirms without interaction.guildId using the configured guild` must pass in the same file.
- **Sent by value.** The test `confirms once and prevents duplicate drafts` expects `sent[0].embeds[0].fields` to contain `{ name: 'Sent by', value: 'U' }` and a second confirm to reject.
- **Driver.** Equivalent one-shot: `.cursor/skills/verify-jarvis/scripts/drive-feature.sh delegated-posts`.
- **Proof.** Exit code `0`. Artifact `.cursor/skills/verify-jarvis/artifacts/delegated-posts/verify.log` contains `Sent by` assertions and a passing Vitest summary.

## Gotchas

- Do not send a real `/post` to GAMING-BRO or any guild. The gateway in this file is an in-memory `sent` array.
- `tests/admin-console.test.ts` covers Command Deck transmission wiring. It does not replace the `Sent by` assertions in `tests/delegated-posts.test.ts`.
- `/post` does not require the engagement master switch. A failure that looks like "engagement disabled" is the wrong file or the wrong fixture, not a live config problem.
- Doctor must refuse `npm run register-commands`. Registration tests are `tests/register-commands.test.ts` only.
