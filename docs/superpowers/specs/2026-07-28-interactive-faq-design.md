# Interactive FAQ Design

## Status

Approved for implementation planning on 2026-07-28.

This design refines GitHub issue #58. It defines a deliberately small first
release and does not imply that broader server knowledge, AI document search,
or Discord-based content administration exists.

## Goal

Give Muthaship members public, deterministic access to approved information
about Jarvis through a `/faq` slash command without invoking AI, web search,
conversation storage, or privileged Discord actions.

## Product decisions

- FAQ content is a checked-in, version-controlled catalog.
- Answers are public by default so the whole channel can benefit.
- The first catalog covers Jarvis only.
- Members select from registered slash-command topic choices.
- Answers are exact approved copy, not model-generated summaries.
- Buttons, dropdown menus, fuzzy search, and Discord-based editing are outside
  this release.

## User experience

Jarvis registers:

```text
/faq topic:<optional approved topic>
```

When `topic` is omitted, Jarvis posts a concise public list of available
questions and explains how to select one. When a topic is supplied, Jarvis
posts that topic's exact approved answer publicly.

The first catalog contains:

1. What can Jarvis do?
2. How do I ask Jarvis something?
3. When should I use `/search`?
4. What does Jarvis remember?
5. How do I clear conversation history?
6. Where does Jarvis run?
7. Can Jarvis modify the Discord server?
8. Why did Jarvis refuse or withhold an answer?
9. What happens when the Shipboard Core is offline?

Copy uses the established Muthaship voice but prioritizes clarity over
role-play. Answers must not claim unimplemented permissions, tools, schedules,
or integrations.

## Architecture

### Catalog

`config/faq.json` is the operator-controlled source of truth. Its root value is
an array of entries:

```json
[
  {
    "id": "capabilities",
    "label": "Jarvis capabilities",
    "question": "What can Jarvis do?",
    "answer": "Approved answer text."
  }
]
```

`src/faq/faq-catalog.ts` owns parsing, validation, normalization, lookup, and
the immutable in-memory representation. It exposes:

```ts
interface FaqEntry {
  readonly id: string;
  readonly label: string;
  readonly question: string;
  readonly answer: string;
}

interface FaqCatalog {
  readonly entries: readonly FaqEntry[];
  get(id: string): FaqEntry | undefined;
}

function loadFaqCatalog(path: string): Promise<FaqCatalog>;
```

The loader uses explicit UTF-8 file access only for the configured catalog
path. Discord input never controls a filesystem path.

### Configuration

`FAQ_CATALOG_PATH` defaults to `./config/faq.json`. Startup resolves and loads
the file before Discord login. Configuration and status surfaces report only
whether the FAQ catalog is configured and loaded, never its absolute path or
content. The command-registration configuration also reads this setting, and
the registration script loads and validates the same catalog before building
the Discord payload.

### Command definition

`/faq` has one optional string option named `topic`. Every catalog entry
becomes a Discord choice using `label` as the visible name and `id` as the
submitted value.

Discord allows at most 25 choices. Catalog validation enforces that maximum
before command registration or bot startup.

### Command handling

The command handler receives the immutable catalog through dependency
injection.

The `/faq` path:

1. Rejects direct messages with the existing server-only response.
2. Enforces the existing channel allowlist, including parent-thread behavior.
3. Reads the optional `topic` string and trims it.
4. Lists available questions when the topic is omitted.
5. Looks up the exact normalized topic ID when supplied.
6. Returns a safe public unknown-topic response if no entry matches.
7. Delivers the exact catalog answer through the existing safe reply helper.

The command does not defer because every response is local and bounded. It
does not call the conversation service, selected AI provider, Tavily, SQLite,
or any extension contract.

### Help and status

`/help` lists `/faq` and describes it as approved Jarvis information.

`/status` includes:

```text
FAQ catalog: loaded
```

Startup fails if the configured catalog cannot be loaded, so a running process
should not report a degraded or partially loaded catalog.

## Validation rules

The catalog loader rejects:

- a root value that is not an array
- zero entries
- more than 25 entries
- non-object entries
- unknown fields
- missing or non-string fields
- leading or trailing whitespace
- duplicate IDs after case normalization
- IDs outside lowercase ASCII letters, digits, and hyphens
- IDs shorter than 1 or longer than 32 characters
- labels shorter than 1 or longer than 100 characters
- questions shorter than 1 or longer than 200 characters
- answers shorter than 1 or longer than 1,800 characters
- NUL characters or Unicode line and paragraph separators

The catalog is frozen after validation. Lookup is case-insensitive for defense
in depth, even though Discord choices submit known lowercase IDs.

## Security and privacy

- The feature adds no Discord intents or permissions.
- It cannot modify roles, channels, permissions, members, messages owned by
  others, server settings, or external systems.
- It performs no AI or web-provider request and therefore adds no provider
  cost.
- It writes no database record and does not become conversation context.
- It uses the existing mass-mention neutralization and disables uncontrolled
  mentions.
- Catalog contents are trusted operator configuration. Pull-request review is
  the authorization boundary for content changes.
- Discord users cannot create, edit, delete, or reload entries.
- The loader does not log answer content or absolute filesystem paths.

## Failure behavior

- Missing, unreadable, or malformed catalog: startup fails with a sanitized
  message naming `FAQ_CATALOG_PATH`, not the resolved path or file contents.
- Direct message: existing server-only message, ephemeral.
- Disallowed channel: existing unavailable-channel message, ephemeral.
- Unknown topic: safe public response that lists the valid topic labels.
- Delivery failure: existing Discord delivery behavior and content-free logs.

There is no runtime fallback to AI. If the approved answer is unavailable,
Jarvis refuses cleanly instead of improvising.

## Testing

Automated tests cover:

- valid catalog loading and immutable lookup
- every catalog validation rule and sanitized errors
- `/faq` registration with optional choices
- the 25-choice boundary
- public topic answers
- public topic listing
- server-only enforcement
- channel and parent-thread allowlisting
- unknown-topic handling
- mass-mention neutralization
- absence of AI, web-search, and storage calls
- `/help` and `/status` updates
- registration payload inclusion
- startup rejection when catalog loading fails

The release gate remains:

```powershell
npm test
npm run lint
npm run format:check
npm run build
npm run docs:check
```

A live development-guild check must verify `/faq`, one selected answer, an
omitted-topic listing, and an attempted use outside the allowlist.

## Deployment

The operator must run `npm run register-commands` once after deploying the
release because the guild command set changes.

Native and Docker deployments include `config/faq.json` and resolve the default
path from the project working directory. Docker must not expose the catalog as
a writable Discord-controlled volume.

Rollback restores the previous application version and re-registers the prior
five-command set. Conversation data does not require migration.

## Explicit non-goals

- Muthaship rules, roles, channel guides, events, or onboarding content
- AI-generated FAQ answers
- semantic or fuzzy question matching
- buttons, select menus, pagination, or component collectors
- Discord commands that edit FAQ content
- database-backed FAQ content
- per-guild catalogs
- automatic file watching or runtime reload
- moderation, administration, or server mutation
