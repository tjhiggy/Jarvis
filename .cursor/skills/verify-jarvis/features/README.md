# Jarvis verification map

This directory is the maintained source for proving shipped Jarvis behavior with the CI harness. Read this index before driving, then use the matching feature file as the recipe.

These entries are features that **can be proven in CI**. They are not a live-guild smoke list and they are not GAMING-BRO.

## Baseline preconditions

- Repository root contains `package.json` name `jarvis-discord-bot` and a committed `package-lock.json`.
- Node.js 22 or newer is on PATH.
- Launch has run: `npm ci --legacy-peer-deps`.
- `.cursor/skills/verify-jarvis/scripts/doctor.sh` prints `doctor: PASS`.
- Process environment has no `DISCORD_TOKEN`. Repo `.env` is absent, or doctor has already refused it.
- Do not start `npm run dev`, `npm start`, or `npm run register-commands`.

## Driving conventions

- Start from the baseline unless a feature file names extra preconditions.
- Treat every command as literal. Keep test file names unchanged.
- Drive through `npm test -- <file>` or the named `npm run` verifier, or `.cursor/skills/verify-jarvis/scripts/drive-feature.sh <feature-id>`.
- Restore nothing in Discord. Tests use mocks and disposable stores.
- Cleanup must not remove `.cursor/skills/verify-jarvis/artifacts/`.

## Proof and skip reporting

- Capture stdout, stderr, and the exit code under `.cursor/skills/verify-jarvis/artifacts/<feature-id>/`.
- A passing Vitest assertion is the observable end state. A Discord message in a guild is not.
- `journeys:verify` writes a sanitized receipt to `.artifacts/qa/discord-journeys.json`. That receipt is not live registration evidence.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with the Jarvis CI harness` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

Keep live-guild steps out of the map. Name only user paths, stable test files, required state, commands, and observable proof.

## Features

- [RSS native Discord cards](./rss-digest.md) covers public RSS posts that send one native Discord card per headline, with no `SuppressEmbeds` and at most one catch-up item per tick.
- [Delegated posts Sent by](./delegated-posts.md) covers `/post` preview and confirm, including the `Sent by` attribution field.
- [Command Deck confirm](./command-deck-confirm.md) covers preview, confirm, cancel, stale, retry, and rollback of Deck mutations.
- [Discord journey matrix](./discord-journey-matrix.md) covers the 36-command journey catalog check and focused verifier.
