# Local Admin Console

Jarvis includes an optional localhost-only Command Deck at `http://127.0.0.1:8787`.
The interface uses the MuthaShip visual language: dark space-console surfaces,
purple navigation accents, and gold Jarvis identity cues. This is presentation
only; it does not grant additional Discord permissions.
Enable it with `ADMIN_CONSOLE_ENABLED=true`, then restart Jarvis. It is read-only:
it reports platform health, providers, integrations, aggregate metrics, and the
configured RSS feeds and pause state. It does not expose tokens, conversation
content, or Discord server-management controls.

The console is intentionally disabled by default and rejects non-local bind
addresses. Discord commands remain the operational fallback. When enabled with
`ADMIN_CONSOLE_TOKEN`, the local operator can preview an allowlisted HTTPS RSS
feed without saving it, and pause or resume the configured RSS scheduler. These
actions require an explicit local confirmation, never expose the token to the
browser page, and do not change Discord permissions or server settings.

The preview endpoint is `POST /api/rss/preview` with
`{"url":"https://example.com/feed.xml"}` and a bearer token. Preview accepts
only feeds allowed by `ENGAGEMENT_RSS_ALLOWED_HOSTS`; it returns at most five
items and never persists the feed. `POST /api/rss/pause` and
`POST /api/rss/resume` control delivery for the configured MuthaShip.
