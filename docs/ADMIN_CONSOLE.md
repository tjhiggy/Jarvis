# Local Admin Console

Jarvis includes an optional localhost-only Command Deck at `http://127.0.0.1:8787`.
The interface is organized as a responsive bridge console with persistent
desktop navigation and a compact mobile section selector. The visual system is
grounded in Jarvis's Discord icon and command-bridge banner: near-black hull
surfaces, restrained violet energy, gold identity cues, and semantic health
colors. This is presentation only; it does not grant additional Discord
permissions.
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

An optional, separately authenticated API supports the private Sites
Command Deck. It is disabled when `COMMAND_DECK_API_TOKEN` is blank and uses a
dedicated token, exact HTTPS origin allowlist, freshness window, replay defense,
rate limiting, metadata-only audit, and a strict safe projection. See the
[Sites Command Deck guide](SITES_COMMAND_DECK.md). The local `/api/status` route
remains the loopback fallback and is not the remote Sites contract.

## Private Sites safe controls

v1.6.0 includes bounded Settings workflows. They stay disabled until
deployment tokens and origin allowlists are configured. `COMMAND_DECK_API_TOKEN`
is the separate read credential; `ADMIN_CONSOLE_TOKEN` is the 32+ character
write credential entered only in the active browser tab. Neither is embedded,
persisted by Sites, or recorded in audit output.

Use the exact private Sites page origin in `COMMAND_DECK_API_ALLOWED_ORIGINS`;
use the Jarvis tunnel/proxy origin for runtime `COMMAND_DECK_API_BASE_URL`.
They are different in separate-host deployments and equal only behind a
same-origin proxy. Retain
`ADMIN_CONSOLE_HOST=127.0.0.1`. CORS/`OPTIONS` is granted only to that origin;
every mutation still needs the write bearer token. Settings allows only
configured broadcast pause/resume, supported feature flags, and approved RSS
feed add/remove. RSS remains HTTPS-host allowlisted and destination-pinned.

Operators select a catalog target, inspect the exact five-minute preview, then
confirm or cancel. Transient failures retry with the same idempotency key;
permanent failures do not retry. Receipts support compensating rollback, which
refuses changed targets. SQLite preserves preview, receipt, and rollback state
across restart. `401`/`403` clears active browser state and requires `Change
access code`. Leave the relevant tokens/origin blank to fail closed; Discord is
the fallback.

The Overview is the operator's first-stop health surface. It shows the current
platform identity, aggregate command events and failures, feature adoption,
integration readiness, and the next obvious action. The Operations section
provides the same observability contract in more detail. It shows
healthy, degraded, or unavailable state, aggregate command events and failures,
configured feature count, and integration readiness. Empty states are explicit,
and the projection is content-free: it never includes message text, member
identity, raw prompts, or secrets.

The console is intentionally disabled by default and rejects non-local bind
addresses. Discord commands remain the operational fallback. When enabled with
`ADMIN_CONSOLE_TOKEN`, the local operator can preview an allowlisted HTTPS RSS
feed without saving it, and pause or resume the configured RSS scheduler. These
actions require an explicit local confirmation, never expose the token to the
browser page, and do not change Discord permissions or server settings.

## One-off broadcasts

The **New transmission** workflow under **Broadcasts** lists only configured
allowlisted text channels by
friendly name. An operator composes up to 1,500 characters, previews the exact
public MuthaShip card in the page, and confirms or cancels without a native
browser dialog. Confirmation is short-lived,
single-use, and bound to the draft. Failed Discord delivery leaves the draft
retryable. Audit logs retain operation, destination ID, time, and outcome only,
never the message content. Discord `/post` remains the fallback workflow.
If Discord cannot resolve a channel name during startup, the allowlisted
destination remains selectable as `Approved channel N`; delivery still performs
the normal live channel and permission checks before posting.

## Command Deck information architecture

- **Overview:** health, deployment identity, metrics, and immediate actions.
- **Community:** engagement modules and privacy-bounded intelligence readiness.
- **Broadcasts:** one-off transmissions, scheduled broadcast controls, and RSS
  preview.
- **Integrations:** RSS, Sleeper Fantasy Football, and provider readiness.
- **Operations:** aggregate observability with no content or member identity.
- **Settings:** the local security boundary and bounded safe configuration
  surfaces.

On desktop the section navigation remains visible. On tablet and mobile it is
replaced by a labeled selector, KPI grids collapse without horizontal overflow,
and controls retain keyboard focus indicators. Health states always include
text labels and do not rely on color alone.

The HTML response uses a nonce-scoped Content Security Policy and denies
framing, MIME sniffing, and referrer leakage. Brand assets are served from
fixed local routes only; the route cannot be used as an arbitrary file reader.

The preview endpoint is `POST /api/rss/preview` with
`{"url":"https://example.com/feed.xml"}` and a bearer token. Preview accepts
only feeds allowed by `ENGAGEMENT_RSS_ALLOWED_HOSTS`; it returns at most five
items and never persists the feed. `POST /api/rss/pause` and
`POST /api/rss/resume` control delivery for the configured MuthaShip.

Command ownership is tracked in the [command surface matrix](COMMAND_SURFACE_MATRIX.md).
That matrix is the v0.6 source of truth for deciding whether a workflow belongs
in Discord, the Command Deck, or both. New controls must update the matrix,
metrics contract, audit behavior, and smoke-test checklist together.
