# Sites Command Deck

Jarvis includes a separate Sites frontend at `sites/command-deck`. The
read-only mirror is the first staged v1.6 slice. The bounded Settings safe
controls from #275 are implemented but **not released or enabled by default**;
they do not replace the localhost Command Deck or Discord fallback commands.

## Operator experience

The frontend provides six responsive areas:

1. **Overview** for platform health, activity, and release identity.
2. **Community** for aggregate, content-free engagement signals.
3. **Broadcasts** for bounded delivery receipts and destination readiness.
4. **Integrations** for Discord, Sleeper Fantasy Football, RSS, and storage.
5. **Operations** for safe activity and loading, empty, degraded, stale,
   unavailable, and unauthorized states.
6. **Settings** for a read-only projection of configuration posture and, only
   after deployment enablement, bounded safe controls.

The interface must never expose message content, member identities, raw prompts,
provider credentials, bot tokens, or unrestricted server administration.

## Authenticated data contract

`app/lib/command-deck.ts` defines contract version `1.0`. The current overview
presentation is static, safe sample data; it is not a live Sites read adapter
and does not call the snapshot route. Jarvis still holds `COMMAND_DECK_API_TOKEN`
because construction of the authenticated mutation API depends on it.

Every request includes `Authorization: Bearer <read-token>`, a fresh ISO date in
`X-Command-Deck-Timestamp`, and a new UUID in `X-Command-Deck-Request-Id`.
Remote requests also require an exact HTTPS origin listed in
`COMMAND_DECK_API_ALLOWED_ORIGINS`. IDs cannot be replayed, stale requests are
rejected, and a fixed-window rate limit applies. The API token must differ from
`ADMIN_CONSOLE_TOKEN`; the write token is entered only for the active Settings
tab and is never embedded, stored in Sites, or retained by the browser.

## Bounded Settings controls

The mutation routes are `GET /api/v1/command-deck/config/catalog` and `POST`
`/preview`, `/confirm`, `/cancel`, and `/rollback`. The browser uses a
runtime-only `COMMAND_DECK_API_BASE_URL`, never a relative URL. It accepts an
HTTPS origin without credentials, path, query, or fragment, or loopback HTTP
for local use. A missing or invalid value fails closed, so a deployed Sites
page never mutates its own origin.

`COMMAND_DECK_API_ALLOWED_ORIGINS` is the browser page's exact Sites origin.
`COMMAND_DECK_API_BASE_URL` is the Jarvis HTTPS tunnel/proxy origin. They differ
in a separate-host topology; use the same value only when a same-origin proxy
serves both. Jarvis permits CORS and `OPTIONS` only for the Sites page origin,
while every non-preflight request still requires its bearer credential.

The catalog bounds operations to configured broadcast categories, supported
feature flags, approved RSS hosts, and existing approved RSS feeds. Operators
preview an exact diff, confirm or cancel a five-minute preview, retry a
transient confirmation with the same idempotency key, and use receipt-backed
compensating rollback. One preview family is active at a time. `401` or `403`
clears in-memory sensitive state and returns to `Change access code`; permanent
safe rejections are distinct from retryable failures.

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

1. Set `ADMIN_CONSOLE_ENABLED=true`, then generate two different random secrets
   of at least 32 characters. Store both in Jarvis; give `ADMIN_CONSOLE_TOKEN`
   to approved operators out of band. Never put the write token in Sites config.
2. Set `COMMAND_DECK_API_ALLOWED_ORIGINS` to the exact private Sites page HTTPS
   origin, without a path or trailing slash.
3. Set the Sites runtime-only `COMMAND_DECK_API_BASE_URL` to the Jarvis HTTPS
   tunnel/proxy origin (or loopback for local use). The browser accepts
   only an origin without credentials, path, query, or fragment; it never falls
   back to the deployed Sites origin. This value is an address, not a token.
4. Keep `ADMIN_CONSOLE_HOST=127.0.0.1`. Publish only through the approved private
   tunnel. Never change Jarvis to a public bind.
5. Restart Jarvis, run `npm run command-deck-api:verify`, then test loading,
   unavailable, unauthorized, stale, preview, cancel, retry, receipt, rollback,
   and restart-recovery states with a disposable allowlisted target.
6. To rotate, update the relevant credential stores, restart Jarvis, verify
   Sites, and revoke the old values. A mismatch fails closed with `401
unauthorized`.

The disposable verifier never reads production configuration. It starts an
isolated loopback console and writes sanitized evidence to
`.artifacts/qa/command-deck-read-api.json`.

## Rollback

If the Sites presentation is unavailable or stale, stop using its URL and use
the localhost Command Deck or Discord fallback. To disable remote writes,
clear `ADMIN_CONSOLE_TOKEN` or remove the allowed origin, restart Jarvis, and
retain the fallback. To disable remote reads too, clear `COMMAND_DECK_API_TOKEN`
and restart. A rollback refuses to overwrite a target changed after the receipt.
