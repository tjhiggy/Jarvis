# Command Deck Authenticated Read API Design

## Purpose

Issue #276 adds a narrow, authenticated read boundary between the local Jarvis
runtime and the private Sites Command Deck. Jarvis remains the source of truth.
The Sites application receives only bounded operational projections.

## Endpoint and contract

- `GET /api/v1/command-deck/snapshot`
- Schema version: `1.0`
- Every success and error response contains `schemaVersion` and `observedAt`.
- Successful projections contain release identity, aggregate health, provider
  configuration posture, integrations, scheduler summaries, feature flags,
  aggregate metrics, freshness metadata, and audit readiness.
- The projection never contains secrets, raw environment values, Discord IDs,
  member identities, messages, prompts, provider payloads, image content,
  unrestricted database rows, or URLs containing credentials or query strings.

## Authentication and request policy

The read API uses a dedicated read-only bearer token. It never reuses the
Command Deck mutation token. A request also supplies:

- `Origin`, which must match an explicitly configured HTTPS origin for a remote
  request. Requests without an origin are accepted only from loopback.
- `X-Command-Deck-Request-Id`, a UUID retained in memory for the request window.
- `X-Command-Deck-Timestamp`, an ISO-8601 timestamp inside the configured clock
  window.

The server rejects missing, malformed, expired, replayed, cross-origin, and
rate-limited requests with safe structured errors. Authentication comparison is
constant-time. Requests are bounded by method and route, and the endpoint does
not accept a body.

## Deployment model

Jarvis binds to `127.0.0.1` by default. Remote Sites access uses the approved
private Sites tunnel so the runtime is not exposed directly to the internet.
The Sites server-side route stores the read token as a Sites secret and sends
authenticated requests through the tunnel. Browser JavaScript never receives
the token. The existing localhost Command Deck and `/api/status` remain the
fallback path.

## Audit and retention

The boundary emits metadata-only receipts containing outcome, request ID,
origin classification, and observation time. It does not log tokens, source IP
addresses, response payloads, or request headers. Replay and rate-limit state is
in-memory and expires automatically.

## Rollback

Disable the read API token and allowed origins, remove the Sites tunnel binding,
and redeploy the previous Sites version. The local Command Deck continues to
work throughout rollback.
