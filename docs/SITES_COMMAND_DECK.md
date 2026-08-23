# Sites Command Deck

Jarvis includes a separate Sites frontend at `sites/command-deck`. This is the
first slice of the staged v1.6 migration. It is deliberately read-only and does
not replace the localhost Command Deck or Discord fallback commands.

## Operator experience

The frontend provides six responsive areas:

1. **Overview** for platform health, activity, and release identity.
2. **Community** for aggregate, content-free engagement signals.
3. **Broadcasts** for bounded delivery receipts and destination readiness.
4. **Integrations** for Discord, Sleeper Fantasy Football, RSS, and storage.
5. **Operations** for safe activity and loading, empty, degraded, stale,
   unavailable, and unauthorized states.
6. **Settings** for a read-only projection of configuration posture.

The interface must never expose message content, member identities, raw prompts,
provider credentials, bot tokens, or unrestricted server administration.

## Data contract

`app/lib/command-deck.ts` defines contract version `1.0`. The checked-in fixture
is realistic but contains no production data. A frontend must reject an unknown
contract version instead of guessing. Sites 2/4 will replace the fixture adapter
with a local authenticated read API while preserving the contract boundary.

## Local verification

From `sites/command-deck`:

```powershell
npm ci
npm test
npm run lint
npm run build
npm run dev
```

Open the printed local URL. Verify all six navigation buttons with a keyboard,
desktop and mobile widths, and the explicit resilient states. The CI workflow
runs the test, lint, and production build gates for every pull request.

## Private deployment

The Sites project is deployed owner-only for this migration slice. The local
Command Deck at `http://127.0.0.1:8787` remains the operational fallback. Do not
make the Sites project public or enable write controls until the authenticated
API, authorization, confirmation, audit, and rollback work is complete.

## Rollback

If the Sites presentation is unavailable or stale, stop using its URL and use
the localhost Command Deck. No Jarvis runtime rollback is required because this
slice has no authority and performs no mutations.
