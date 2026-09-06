# Caleb to Jarvis handoff lifecycle

This document is a review of the current repository, not a shipped feature.
Jarvis has no Caleb-to-Jarvis inbound handoff. A passing review here means the
fail-closed boundary is still intact, not that an external agent can submit
work.

The intended lifecycle, if one is implemented later, has three stages:

1. **Authenticated receipt.** Jarvis accepts a bounded payload only after a
   dedicated credential and request authenticity check succeed.
2. **Durable request and event persistence.** The accepted payload becomes a
   local request row and an append-only event history that survive process
   restart.
3. **Approval gating.** A later side effect runs only after a distinct human
   approval record, not because receipt or persistence succeeded.

Those stages are not wired together today. Adjacent surfaces cover pieces of
authentication, storage, or confirmation, but they do not form this lifecycle.

## Current inventory

### Authenticated receipt

Jarvis receives Discord gateway events and optional localhost Command Deck
HTTP. It exposes no public inbound port and no Caleb or handoff route.

| Surface                            | What exists                                                     | Why it is not a handoff receipt                                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Discord gateway and slash commands | Guild mentions and registered chat-input commands               | Ingress is Discord-authenticated only. There is no `caleb` or `handoff` command.                                                                |
| Administrator `/request`           | Captains-quarters, configured administrator role, what/why/done | A human Discord command, not an external-agent receiver.                                                                                        |
| Command Deck HTTP                  | Loopback bind, bearer tokens, unknown paths return 404          | Catalog, snapshot, broadcast, post, and RSS routes only. `/api/handoff`, `/api/caleb`, and `/api/v1/command-deck/config/handoff` are not found. |
| REST boundary                      | Outbound GET/HEAD host allowlist                                | No inbound listener or POST receiver.                                                                                                           |
| Webhook boundary                   | Outbound host, timeout, and byte-limit policy                   | No inbound verify, acknowledge, or receive function. `requireSignature: false` is accepted when hosts are present.                              |

`.env.example` and `src/config/config.ts` define no `CALEB_*` or `HANDOFF_*`
keys. Disabled extension contracts remain `enabled: false` with an operator
approval reason and are not a receiver.

### Durable request and event persistence

No production SQLite schema creates `caleb_*` or `handoff_*` tables. There is
no local request row, correlation ID, or event history for an external handoff.

| Nearby store                       | What it persists                                                                     | Handoff gap                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `/request`                         | A GitHub issue plus a public Discord REQUEST, and only after issue creation succeeds | Failure stays ephemeral. Jarvis does not keep a local request or event log.  |
| Command Deck mutations             | Preview, completion, and rollback rows for configured Deck actions                   | Those rows are Settings and broadcast controls, not inbound handoff records. |
| Conversation and engagement stores | Channel history and crew-feature rows                                                | Unrelated to an external-agent request.                                      |
| Knowledge approvals                | Per-server catalog source overrides                                                  | Not a handoff approval or event log.                                         |

Receipt therefore cannot be reconstructed after restart unless GitHub or
Discord still holds a successful `/request` issue or message.

### Approval gating

Existing gates protect their own surfaces. None of them can hold an
authenticated external payload in a pending state and later release a distinct
side effect.

| Gate                               | Current rule                                                        | Handoff gap                                                                       |
| ---------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `/request`                         | Guild, captains-quarters channel, and configured administrator role | Success creates the GitHub issue immediately. There is no pending-approval state. |
| Command Deck writes                | Dedicated bearer token, origin policy, and confirmation nonce       | Applies to configured Deck mutations only.                                        |
| Knowledge `/approve` and `/revoke` | Configured administrators change catalog eligibility                | Does not approve an inbound request payload.                                      |
| Extension contracts                | `enabled: false`, reason `operator approval required`               | Declarations only. They grant no runtime path.                                    |

A payload that is never received cannot be stored, and a row that is never
stored cannot wait for approval. The three stages are all absent, not merely
loosely connected.

## Remaining gaps

A future implementation would still need reviewed production work. This
assignment does not add that work.

1. **Receipt.** Add an authenticated inbound contract with a dedicated
   credential, replay and freshness checks, a bounded payload, and a content-free
   deny path. Reusing `ADMIN_CONSOLE_TOKEN`, `COMMAND_DECK_API_TOKEN`, or
   `DISCORD_TOKEN` would collapse trust boundaries.
2. **Persistence.** Add local request and event tables with correlation IDs,
   retention, and restart recovery that do not depend on GitHub or Discord
   remaining available.
3. **Gating.** Add an explicit pending-to-approved transition owned by a human
   operator. Receipt and persistence must not execute `/request`, Command Deck
   writes, Discord posts, or provider calls.
4. **Webhook signatures.** `validateWebhookPolicy` records `requireSignature`
   but does not reject `false`. That is acceptable only while the module stays
   outbound policy. An inbound receiver would need enforcement, not a stored
   flag.
5. **Tests.** Adjacent suites cover webhook policy, REST policy, `/request`,
   and Command Deck auth. They did not previously lock the missing three-stage
   join. `tests/caleb-handoff-lifecycle.test.ts` is the focused regression for
   that join.

## Verification

Focused evidence is `tests/caleb-handoff-lifecycle.test.ts`. It reads
production modules and starts a disposable Command Deck. It does not open a
public port, add credentials, or call live Discord or GitHub.

Related suites remain valid for nearby surfaces:

- `tests/webhook-boundary.test.ts`
- `tests/rest-boundary.test.ts`
- `tests/request-command.test.ts`
- `tests/admin-console.test.ts`
- `tests/command-permissions.test.ts`

Run:

```bash
npm test -- tests/caleb-handoff-lifecycle.test.ts tests/webhook-boundary.test.ts tests/rest-boundary.test.ts tests/request-command.test.ts --reporter=verbose
```

## Non-goals

This review does not add an inbound server, environment keys, MCP servers,
GitHub credentials, Discord registration, or production behavior. It does not
claim a shipped Caleb integration.
