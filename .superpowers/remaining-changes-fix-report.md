# Remaining Jarvis Changes Fix Report

Date: 2026-07-28

## Status

The audited fixes are implemented and validated in the working tree. Nothing
was staged, committed, pushed, deleted, or changed in Discord or any external
service.

The existing Jarvis persona and capability work was preserved. The only
behavioral corrections in this pass were:

1. Restore the least-privilege Discord gateway intent set.
2. Move raw Discord member-ID replacement to the shared conversation request
   normalization boundary.
3. Rename the local capability gate to an unsupported-action classifier and
   make its UX-only role explicit.
4. Correct the classifier's informational/drafting allow cases and common
   unsupported-action variants.
5. Correct project documentation so the classifier is never described as
   authorization.

## Files changed by this fix pass

- `CHANGELOG.md`
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY_MODEL.md`
- `src/discord/handlers.ts` (restored to the tracked least-intent and raw-ingress
  behavior, so it has no final diff against `HEAD`)
- `src/security/unsupported-action-classifier.ts`
- `src/services/conversation-service.ts`
- `tests/commands.test.ts`
- `tests/conversation-service.test.ts`
- `tests/handlers.test.ts`

`src/utils/mentions.ts` already contained the uncommitted
`replaceUnverifiedUserMentions` helper when this task began. This pass preserved
that helper and moved its use to `ConversationService`. Existing uncommitted
persona changes in `config/jarvis-persona.md`, `src/config/persona.ts`, and
`tests/persona.test.ts` were not rewritten.

## TDD evidence

### RED: gateway intents and mention ingress

Command:

```powershell
npm test -- --run tests/handlers.test.ts
```

Observed result before production changes:

- Exit code: 1
- 15 tests run
- 2 failed
- The gateway-intent test received `[Guilds, GuildMessages, MessageContent]`
  instead of `[Guilds, GuildMessages]`.
- The mention-ingress test received an already-replaced member reference
  instead of the raw member ID expected at the adapter-to-service boundary.

### RED: shared normalization and unsupported-action classification

Command:

```powershell
npm test -- --run tests/conversation-service.test.ts
```

Observed result before production changes:

- Exit code: 1
- 48 tests run
- 9 failed
- Five action variants incorrectly reached the AI:
  - `Set up a reminder for me`
  - `Schedule me a reminder tomorrow`
  - `Ban that user`
  - `Erase the Discord channel`
  - `Please schedule an email to the crew`
- Three drafting/informational requests were incorrectly blocked:
  - `Create a Discord server setup checklist`
  - `Create a repository README draft`
  - `Create an image prompt for the MuthaShip`
- Raw Discord member IDs reached the AI and storage instead of being replaced
  at the shared request boundary.

### Slash-command ingress characterization

Command:

```powershell
npm test -- --run tests/commands.test.ts
```

Observed before production changes:

- Exit code: 0
- 18 tests passed
- The new test confirmed that slash-command ingress already forwards the raw
  member ID to `ConversationService`, which is the desired adapter contract.

### GREEN: targeted suites

Commands:

```powershell
npm test -- --run tests/handlers.test.ts
npm test -- --run tests/conversation-service.test.ts
npm test -- --run tests/commands.test.ts
```

Observed after the minimal production changes:

- `tests/handlers.test.ts`: 15 passed
- `tests/conversation-service.test.ts`: 48 passed
- `tests/commands.test.ts`: 18 passed
- No targeted failures

## Implementation details

- `GatewayIntentBits.MessageContent` is no longer requested. Jarvis retains
  `Guilds` and `GuildMessages`, relying on Discord's content exception for
  messages that mention the application.
- Mention and slash-command adapters both forward the raw prompt to
  `ConversationService`.
- `ConversationService.normalize()` replaces numeric `<@id>` and `<@!id>`
  member references before validation, persistence, classification, search, or
  provider use.
- The regression test expects exactly one replacement per raw member reference,
  preventing sanitization from drifting back into multiple ingress layers.
- `capability-gate.ts` was replaced by
  `unsupported-action-classifier.ts`.
- The public API is now `classifyUnsupportedAction`.
- Its source comment explicitly says it is not an authorization boundary, does
  not inspect Discord permissions, and cannot grant or revoke capabilities.
- Draft/checklist/prompt composition requests reach the AI. Obvious requests
  for actions this release cannot perform receive the existing local limitation
  messages.

## Full validation

Fresh commands and results:

```text
npm test
  PASS: 16 test files, 197 tests

npm run lint
  PASS: ESLint exit code 0

npm run format:check
  PASS: all matched files use Prettier style

npm run build
  PASS: TypeScript compiler exit code 0

npm run docs:check
  PASS: 31 tracked files, 27 environment keys, 10 package scripts

git diff --check
  PASS: exit code 0
```

## Concerns and limitations

- The unsupported-action classifier is intentionally heuristic. It improves
  response clarity and avoids pointless provider calls, but it is not a
  security control and must never become an authorization decision.
- No live Discord event was sent during this pass. Gateway and ingress behavior
  is covered by mocked adapter tests and TypeScript integration tests.
- The working tree still contains the user's broader uncommitted persona and
  capability changes. This report does not recommend splitting or committing
  them without the parent task's final review.
- The report itself is untracked under `.superpowers/` as explicitly requested.

## Review round 1

### RED

The first review found that drafting and informational exemptions were checked
before polite prefixes were stripped, while unsupported-action patterns were
checked afterward. It also identified two missing action phrasings.

Tests were added first for these exact requests:

- Allow `Could you write a file parser in TypeScript`.
- Allow `Please write a GitHub README`.
- Block `Schedule me an email tomorrow`.
- Block `Set my timer for five minutes`.

Command:

```powershell
npm test -- --run tests/conversation-service.test.ts
```

Observed before the classifier fix:

- Exit code: 1
- 52 tests run
- 4 failed
- Both polite drafting requests were incorrectly answered locally.
- Both unsupported scheduled-action requests incorrectly reached the AI.

### GREEN

The classifier now strips the polite action prefix before applying both
informational and drafting exemptions. Reminder matching accepts the possessive
`my`, and scheduled communication matching accepts `me`.

Command:

```powershell
npm test -- --run tests/conversation-service.test.ts
```

Observed after the minimal classifier fix:

- Exit code: 0
- 52 tests passed
- No targeted failures

The changelog was also corrected: it no longer claims least-intent gateway
configuration as a new change when tracked `HEAD` already had that behavior.
The actual persona rewrite is now recorded, including its sharper voice,
anti-fabrication discipline, and verified-member-data boundary.
