# Sites Command Deck

Jarvis includes a separate Sites frontend at `sites/command-deck`. In v1.6.0 it
is the documented remote Command Deck entry when privately published. The
localhost Command Deck at `http://127.0.0.1:8787` and Discord commands remain
the operational fallback. This repository does not host the owner-only Sites
URL.

## Operator experience

The frontend provides six responsive areas:

1. **Overview** for platform health, activity, and release identity.
2. **Community** for aggregate, content-free engagement signals.
3. **Broadcasts** for bounded delivery receipts and destination readiness.
4. **Integrations** for Discord, Sleeper Fantasy Football, RSS, and storage.
5. **Operations** for safe activity and loading, empty, degraded, stale,
   unavailable, and unauthorized states.
6. **Settings** for configuration posture and, after the write access code is
   entered, bounded safe controls.

Without Sites read configuration the Overview is an explicit **Sample**
snapshot. With `COMMAND_DECK_API_BASE_URL`, `COMMAND_DECK_READ_TOKEN`, and
`COMMAND_DECK_PAGE_ORIGIN` the Sites server fetches
`GET /api/v1/command-deck/snapshot` and labels the result **Live**. A failed
fetch is **Offline**. The read token never enters browser JavaScript.

The interface must never expose message content, member identities, raw prompts,
provider credentials, bot tokens, or unrestricted server administration.

## Authenticated data contract

`app/lib/command-deck.ts` defines presentation contract version `1.0`. The
Jarvis snapshot schema is owned by `command-deck-read-api.ts`. Sites maps that
bounded projection into the operator UI.

Every Jarvis request includes `Authorization: Bearer <read-token>`, a fresh ISO
date in `X-Command-Deck-Timestamp`, a new UUID in `X-Command-Deck-Request-Id`,
and `Origin` equal to `COMMAND_DECK_PAGE_ORIGIN`. Remote requests also require
that origin in `COMMAND_DECK_API_ALLOWED_ORIGINS`. IDs cannot be replayed,
stale requests are rejected, and a fixed-window rate limit applies. The API
token must differ from `ADMIN_CONSOLE_TOKEN`; the write token is entered only
for the active Settings tab and is never embedded, stored in Sites, or retained
by the browser.

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

From the repository root also run `npm run command-deck-cutover:verify`. Open
the printed local URL. Verify all six navigation buttons with a keyboard,
desktop and mobile widths, Sample versus Live versus Offline labels, and the
explicit resilient states. The CI workflow runs the test, lint, production
build, and cutover gates.

## Private deployment

Deploy the Sites project owner-only. Keep Jarvis bound to `127.0.0.1` and
publish only through the approved private tunnel.

### Setup and rotation

1. Set `ADMIN_CONSOLE_ENABLED=true`, then generate two different random secrets
   of at least 32 characters. Store both in Jarvis; give `ADMIN_CONSOLE_TOKEN`
   to approved operators out of band. Never put the write token in Sites config.
2. Set `COMMAND_DECK_API_ALLOWED_ORIGINS` to the exact private Sites page HTTPS
   origin, without a path or trailing slash.
3. Set Sites `COMMAND_DECK_API_BASE_URL` to the Jarvis HTTPS tunnel/proxy
   origin (or loopback for local use). Set `COMMAND_DECK_READ_TOKEN` to the
   same value as Jarvis `COMMAND_DECK_API_TOKEN`. Set `COMMAND_DECK_PAGE_ORIGIN`
   to the exact Sites page HTTPS origin. The browser never receives the read
   token.
4. Keep `ADMIN_CONSOLE_HOST=127.0.0.1`. Publish only through the approved private
   tunnel. Never change Jarvis to a public bind.
5. Restart Jarvis, run `npm run command-deck-api:verify` and
   `npm run command-deck-cutover:verify`, then test loading, unavailable,
   unauthorized, stale, preview, cancel, retry, receipt, rollback, and
   restart-recovery states with a disposable allowlisted target.
6. To rotate, update the relevant credential stores, restart Jarvis, verify
   Sites, and revoke the old values. A mismatch fails closed with `401
unauthorized`.

The disposable verifiers never read production configuration. They start an
isolated loopback console and write sanitized evidence to
`.artifacts/qa/command-deck-read-api.json` and
`.artifacts/qa/command-deck-cutover.json`.

## Rollback

If the Sites presentation is unavailable or stale, stop using its URL and use
the localhost Command Deck or Discord fallback. To disable remote writes,
clear `ADMIN_CONSOLE_TOKEN` or remove the allowed origin, restart Jarvis, and
retain the fallback. To disable remote reads too, clear `COMMAND_DECK_API_TOKEN`
and restart. A rollback refuses to overwrite a target changed after the receipt.
