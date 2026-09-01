---
name: verify-jarvis
description: Use when proving Jarvis work on tjhiggy/Jarvis, after a code or test change, before claiming a shipped Discord or Command Deck feature works, or when a Cloud Agent must show CI-harness evidence without Jim or Ellis driving a live guild.
---

# Verify Jarvis

Jarvis is proven by the existing test and CI harness, not by the live Discord ship and not by GAMING-BRO. A passing focused Vitest file, journey check, or recovery verifier is evidence. A live `/command` in a guild is not part of this skill.

## When to use

- A Cloud Agent changed Jarvis code, tests, docs, or CI wiring and must prove the change.
- A shipped feature from `docs/SHIPPED_FEATURE_VERIFICATION.md` needs a repeatable, credential-free check.
- Someone asks to "verify it" and the safe surface is Vitest or the journey/recovery scripts.

Do not use this skill to deploy, publish Sites, register Discord commands, start `npm run dev` / `npm start` against real tokens, edit `.env`, or drive GAMING-BRO.

## Launch

There is no verification server to keep alive. Launch means install the lockfile once so Vitest and the `tsx` verifiers can run.

```bash
cd "$(git rev-parse --show-toplevel)"
npm ci --legacy-peer-deps
```

Ready when `node_modules/.bin/vitest` exists. Node.js 22 or newer is required. Tests do not need a Discord connection, provider keys, or a local `.env`.

Do not run `npm run dev`, `npm start`, `npm run register-commands`, or any Sites publish step.

Optional documentation gate, only when PowerShell 7 is on PATH (GitHub Actions `verify` always has it; Linux Cloud Agent VMs often do not):

```bash
command -v pwsh >/dev/null && npm run docs:check
```

Missing `pwsh` is not a product defect. Do not rewrite `docs:check`.

## Doctor

Run this first, and again whenever anything looks off. It is read-only, does not source `.env`, and **fails closed** on live Discord, `register-commands`, a production `.env`, or GAMING-BRO.

```bash
.cursor/skills/verify-jarvis/scripts/doctor.sh
```

Pass any command you are about to run as `--intent` so doctor can refuse it:

```bash
.cursor/skills/verify-jarvis/scripts/doctor.sh --intent 'npm run register-commands'
# expected: FAIL closed
```

Doctor fails when any of these are true:

- `DISCORD_TOKEN` is set in the process environment
- `DISCORD_CLIENT_ID` and `DISCORD_GUILD_ID` are both set
- `JARVIS_ENVIRONMENT` is `production`, `prod`, or `live`
- repo `.env` has a non-empty `DISCORD_TOKEN` or a production `JARVIS_ENVIRONMENT`
- `--env-file` points at a production or token-bearing env file
- `--intent` (or `npm_lifecycle_event`) names `register-commands`, `npm start`, `npm run dev`, GAMING-BRO, live Discord, or Sites publish
- a live-Discord override variable is set (`VERIFY_JARVIS_ALLOW_LIVE` or `VERIFY_JARVIS_ALLOW_DISCORD`) — there is no override
- `node_modules/.bin/vitest` is missing (launch first), unless `--skip-modules`

`npx vitest run tests/register-commands.test.ts` is allowed. `npm run register-commands` is not. Doctor never prints secret values.

## Drive

Read `features/README.md`, then the matching feature file. Drive **every entry point that file lists**. A proof that runs one convenient test while the map lists others is incomplete.

Harness is npm + Vitest + the repo's `tsx` verifiers. Real commands from this checkout:

| Purpose | Command |
| --- | --- |
| Install | `npm ci --legacy-peer-deps` |
| Journey catalog vs committed matrix | `npm run journeys:check` |
| Journey focused evidence + receipt | `npm run journeys:verify` |
| Recovery focused evidence + receipt | `npm run recovery:verify` |
| Full Vitest suite | `npm test` |
| TypeScript build | `npm run build` |
| Docs gate | `npm run docs:check` (only if `pwsh` exists) |
| One mapped feature | `.cursor/skills/verify-jarvis/scripts/drive-feature.sh <feature-id>` |

Feature IDs: `rss-digest`, `delegated-posts`, `command-deck-confirm`, `discord-journey-matrix`.

Focused files use `npm test -- tests/<file>.test.ts --reporter=verbose` so the artifact names the assertion. Do not substitute a live guild smoke, Command Deck click-through against a real token, or GAMING-BRO.

Two verification runs may share `node_modules`. Do not run a second `npm ci` against the same tree in parallel. Do not start a Jarvis process.

## Evidence

Named artifacts path (survives cleanup):

```text
.cursor/skills/verify-jarvis/artifacts/<feature-id>/
├── verify.txt    # full command stdout/stderr (`.txt` so gitignore `*.log` does not hide proof)
└── meta.txt      # command, UTC timestamps, exit codes
```

Seed-proof transcripts from generating this skill live under `artifacts/seed-proof/`.

Proof standards:

- Exercise the mapped test or verifier, not an internal setter and not a live Discord message.
- Capture the command, the output, and the exit code. A green summary line without the log is not enough.
- Journey and recovery receipts at `.artifacts/qa/*.json` are git-ignored local receipts. They are supporting evidence, not a replacement for the named skill artifacts.
- Never copy `.env`, tokens, guild IDs, message content, or production SQLite into artifacts.
- `journeys:verify` and `recovery:verify` already sanitize receipts. Do not re-print their raw child output into chat if it might contain identifiers.

## Cleanup

```bash
.cursor/skills/verify-jarvis/scripts/cleanup.sh
```

Cleanup removes `/tmp/verify-jarvis-scratch` and any PIDs recorded in `/tmp/verify-jarvis-scratch.pids`. It never deletes `.cursor/skills/verify-jarvis/artifacts/`. After cleanup, confirm that directory still exists. A cleanup that eats the proof has failed.

Never kill by process name. This skill does not start a bot, so there should be no Jarvis PID to stop.

## Helpers

All three scripts are executable. Invoke them from the repository root as shown above.

- `scripts/doctor.sh` — fail-closed readiness and live-ship refusal
- `scripts/drive-feature.sh <feature-id>` — run one mapped feature and write artifacts
- `scripts/cleanup.sh` — remove scratch only

## Forbidden

| Excuse | Reality |
| --- | --- |
| "I'll just `/rss` it in GAMING-BRO" | Live guild is out of scope. Drive `rss-digest`. |
| "register-commands is how you verify slash commands" | That mutates a guild. Use `tests/register-commands.test.ts` only. |
| "I have a production `.env`, doctor should allow it" | Doctor fails closed. Move the file aside or use a checkout without secrets. |
| "npm start on localhost is close enough" | Do not start the production bot against real tokens. |
| "Cleanup should reset artifacts too" | Artifacts are the proof. Leave them. |

## Maintenance

When mapped features drift, use `/maintain-verification-skill` and keep edits inside `.cursor/skills/verify-jarvis/`.
