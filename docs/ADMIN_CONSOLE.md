# Local Admin Console

Jarvis includes an optional localhost-only Command Deck at `http://127.0.0.1:8787`.
The interface uses the MuthaShip visual language: dark space-console surfaces,
purple navigation accents, and gold Jarvis identity cues. This is presentation
only; it does not grant additional Discord permissions.
Enable it with `ADMIN_CONSOLE_ENABLED=true`, then restart Jarvis. It reports
platform health, providers, integrations, aggregate metrics, configured RSS
feeds, broadcast state, and a privacy-bounded Community Intelligence card. The
intelligence card reports approved-source totals, retained-search readiness,
the aggregate number of members who opted into private command statistics,
image-generation readiness, and the configured local model. It never exposes
member identities, source content, conversation text, prompts, or generated
images. With `ADMIN_CONSOLE_TOKEN`, it also provides
bounded, confirmed operator workflows. It does not expose tokens, conversation
content, or Discord server-management controls.

The console is intentionally disabled by default and rejects non-local bind
addresses. Discord commands remain the operational fallback. When enabled with
`ADMIN_CONSOLE_TOKEN`, the local operator can preview an allowlisted HTTPS RSS
feed without saving it, and pause or resume the configured RSS scheduler. These
actions require an explicit local confirmation, never expose the token to the
browser page, and do not change Discord permissions or server settings.

## One-off broadcasts

The **New broadcast** card lists only configured allowlisted text channels by
friendly name. An operator composes up to 1,500 characters, previews the exact
public MuthaShip card, and confirms or cancels. Confirmation is short-lived,
single-use, and bound to the draft. Failed Discord delivery leaves the draft
retryable. Audit logs retain operation, destination ID, time, and outcome only,
never the message content. Discord `/post` remains the fallback workflow.
If Discord cannot resolve a channel name during startup, the allowlisted
destination remains selectable as `Approved channel N`; delivery still performs
the normal live channel and permission checks before posting.

The preview endpoint is `POST /api/rss/preview` with
`{"url":"https://example.com/feed.xml"}` and a bearer token. Preview accepts
only feeds allowed by `ENGAGEMENT_RSS_ALLOWED_HOSTS`; it returns at most five
items and never persists the feed. `POST /api/rss/pause` and
`POST /api/rss/resume` control delivery for the configured MuthaShip.

Command ownership is tracked in the [command surface matrix](COMMAND_SURFACE_MATRIX.md).
That matrix is the v0.6 source of truth for deciding whether a workflow belongs
in Discord, the Command Deck, or both. New controls must update the matrix,
metrics contract, audit behavior, and smoke-test checklist together.
