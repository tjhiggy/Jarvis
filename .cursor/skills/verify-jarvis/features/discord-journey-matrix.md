# Discord journey matrix

The versioned journey matrix owns every registered slash command and the cross-cutting interactive, privacy, configuration, safety, and mobile obligations. The CI verifier checks the catalog against the committed matrix and runs focused supporting tests with inherited credentials removed. It does not register commands and it is not live guild evidence.

## Sub-features

- `journeys-check` validates the typed catalog and confirms `docs/DISCORD_JOURNEY_VERIFICATION.md` is current.
- `journeys-verify` runs the exact focused evidence set and writes a sanitized receipt.
- `journeys-inventory` fails when registered command names drift from `publishedDiscordCommandNames`.
- `journeys-non-live` keeps outcomes that still need a human smoke visible as `manual-required` or `configuration-dependent`.

## How to get to it (user POV)

- Crew members reach each command as a Discord slash command (`/ask`, `/post`, `/rss`, and the rest of the 36).
- Operators read the committed matrix in `docs/DISCORD_JOURNEY_VERIFICATION.md`.
- Cloud Agents reach the same inventory through `npm run journeys:check` and `npm run journeys:verify`.

## Driving it with the Jarvis CI harness

Preconditions:

- Doctor has passed.
- `node_modules/.bin/vitest` exists.
- No Discord token is in the environment.

- **Catalog freshness.** Run `npm run journeys:check`. Exit code `0` and a console line that the Discord journey matrix is current. A stale `docs/DISCORD_JOURNEY_VERIFICATION.md` fails here; do not run `journeys:write` unless the catalog change is the assigned work.
- **Focused evidence.** Run `npm run journeys:verify`. Exit code `0`. The verifier executes the mapped test files with a disposable environment and writes `.artifacts/qa/discord-journeys.json`.
- **Driver.** Equivalent one-shot: `.cursor/skills/verify-jarvis/scripts/drive-feature.sh discord-journey-matrix`.
- **Proof.** Artifact `.cursor/skills/verify-jarvis/artifacts/discord-journey-matrix/verify.txt` contains both commands and exit `0`. The git-ignored receipt is supporting evidence only. It must not be copied into the skill artifacts if it would include identifiers; the sanitized file is already redacted, but the named proof is the command transcript.

## Gotchas

- Automated journey evidence is not live registration, deployed permission, or mobile-rendering proof. The matrix says so on purpose. Do not "complete" a `manual-required` row by posting in GAMING-BRO as part of this skill.
- `npm run register-commands` is the opposite of this feature. Doctor must refuse it. `tests/register-commands.test.ts` is the registration *regression*, not a guild PUT.
- `npm run journeys:write` rewrites the committed matrix. That is a catalog change, not a verify step.
- `npm run recovery:verify` is a sibling CI gate. Do not report recovery receipts as journey proof.
- Linux Cloud Agents skip `docs:check` when `pwsh` is absent. That skip does not skip `journeys:check`.
