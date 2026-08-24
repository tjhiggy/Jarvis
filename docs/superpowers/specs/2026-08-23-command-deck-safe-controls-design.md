# Command Deck Safe Controls Design

## Goal

Add the first bounded write workflows to the Sites Command Deck without turning a public web surface into a Discord administration backdoor.

## Scope

The release supports three control families:

- pause or resume an allowlisted broadcast category;
- enable or disable a supported community feature flag;
- add or remove an allowlisted RSS feed while retaining the configured RSS destination channel.

Channel choice is shown and validated from Jarvis's existing channel allowlist. The control plane cannot add Discord channels, edit secrets, change roles, moderate members, or mutate arbitrary environment values.

## Architecture

Local Jarvis remains authoritative. A versioned mutation service owns preview sessions, exact before/after diffs, expiry, one-shot confirmation, retry-safe failures, rollback receipts, and metadata-only audit events. The local HTTP server exposes that service through authenticated JSON endpoints under `/api/v1/command-deck/config`. The Sites client renders the safe catalog, preview, confirmation, cancellation, retry, and rollback controls. Discord commands remain the fallback.

The mutation API uses the existing Command Deck bearer token, origin allowlist, replay protection, clock-skew checks, and rate limiting. Every request supplies a UUID request ID and canonical UTC timestamp. Confirmation also requires an idempotency key. Preview sessions expire after five minutes and are bound to the requested action and target.

## Control contract

Supported actions are discriminated JSON objects:

- `broadcast_state`: category plus `enabled` or `paused`;
- `feature_flag`: supported feature name plus boolean enabled state;
- `rss_feed`: `add` with bounded HTTPS URL and label, or `remove` with an existing URL.

Preview returns a server-generated preview ID, expiry, human-readable target, and explicit before/after values. Confirm returns an audit receipt and optional rollback token. A failed confirmation stays retryable with the same idempotency key. A successful confirmation is replay-safe and returns its original receipt. Cancel invalidates an unused preview. Rollback is a compensating action that restores the exact previous value when the adapter still reports the expected post-change value.

## Safety boundaries

- Only known action types and allowlisted targets are accepted.
- Uncontrolled mentions, message bodies, secrets, tokens, raw environment values, and Discord content never enter audit records.
- Stale, cancelled, unauthorized, replayed, and mismatched requests fail closed.
- A failed adapter call never reports success and does not consume the preview.
- Rollback refuses to overwrite a value that changed after the original operation.
- Responses use stable error codes and safe operator text.

## UI and resilience

Settings displays control cards only when the snapshot advertises the capability. The operator selects a bounded target and desired state, previews an exact diff, then confirms or cancels. Loading, unauthorized, stale, failure, retryable, succeeded, and rolled-back states have explicit copy. The browser stores credentials only in memory for the active tab. No token is embedded in the deployed Sites bundle.

## Testing and release evidence

Unit tests cover validation, expiry, idempotency, failure retry, cancellation, and rollback conflicts. API tests cover authentication, origin enforcement, non-allowlisted denial, bounded bodies, safe errors, and audit metadata. Integration tests use real feature, broadcast, and RSS adapters. Sites tests cover the full operator journey and resilient states. Release evidence includes tests, lint, builds, audit, restart rehearsal, browser QA, exact preview examples, and rollback proof.
