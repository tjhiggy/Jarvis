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

## Authenticated data contract

`app/lib/command-deck.ts` defines contract version `1.0`. Jarvis now exposes the
matching projection at `GET /api/v1/command-deck/snapshot`. The API is disabled
until `COMMAND_DECK_API_TOKEN` is configured. It returns operational state only:
release identity, health, provider configuration posture, integration readiness,
scheduler state, allowlisted flags, bounded metrics, and audit readiness.

Every request includes `Authorization: Bearer <read-token>`, a fresh ISO date in
`X-Command-Deck-Timestamp`, and a new UUID in `X-Command-Deck-Request-Id`.
Remote requests also require an exact HTTPS origin listed in
`COMMAND_DECK_API_ALLOWED_ORIGINS`. IDs cannot be replayed, stale requests are
rejected, and a fixed-window rate limit applies. The read token must differ from
`ADMIN_CONSOLE_TOKEN` and must exist only in the Sites server-side adapter.

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

### Setup and rotation

1. Generate a random secret of at least 32 characters and store it as
   `COMMAND_DECK_API_TOKEN` in Jarvis and the private Sites server secret store.
2. Set `COMMAND_DECK_API_ALLOWED_ORIGINS` to the exact private Sites HTTPS
   origin, without a path or trailing slash.
3. Keep `ADMIN_CONSOLE_HOST=127.0.0.1`. Publish only through the approved private
   tunnel. Never change Jarvis to a public bind.
4. Restart Jarvis, run `npm run command-deck-api:verify`, then test the Sites
   loading, unavailable, unauthorized, and stale states.
5. To rotate, update both secret stores, restart Jarvis, verify Sites, and revoke
   the old value. A mismatch fails closed with `401 unauthorized`.

The disposable verifier never reads production configuration. It starts an
isolated loopback console and writes sanitized evidence to
`.artifacts/qa/command-deck-read-api.json`.

## Rollback

If the Sites presentation is unavailable or stale, stop using its URL and use
the localhost Command Deck. No Jarvis runtime rollback is required because this
slice has no mutation authority. To disable remote reads immediately, clear
`COMMAND_DECK_API_TOKEN`, restart Jarvis, and retain the localhost fallback.
