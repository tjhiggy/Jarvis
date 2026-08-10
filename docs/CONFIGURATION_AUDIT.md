# Configuration audit log

Jarvis keeps a small, server-isolated audit trail for configuration state changes. It records metadata only: server ID, actor ID, operation, target, enabled state when applicable, and timestamp. It never stores API keys, message text, prompts, or arbitrary configuration values.

The current storage layer records feature-flag and proactive-state changes. Entries are retained through the normal engagement cleanup window and are deleted when they expire. Reads are bounded to 100 entries per request and must always be scoped to a single server.

This is an operational audit trail, not a Discord moderation log. It does not grant Jarvis permission to change server settings, roles, channels, or external systems. Future admin-facing commands must enforce the configured administrator role allowlist, use ephemeral responses, and expose only the requesting server's entries.

## Privacy and safety

- Server isolation is enforced in every query.
- Audit records contain no message content or secrets.
- Retention uses the existing engagement cleanup policy.
- The log is read-only to administrators once entries are written.
- Invalid operations and unbounded limits are rejected.
