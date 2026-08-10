# Local Admin Console

Jarvis includes an optional localhost-only Command Deck at `http://127.0.0.1:8787`.
Enable it with `ADMIN_CONSOLE_ENABLED=true`, then restart Jarvis. It is read-only:
it reports platform health, providers, integrations, aggregate metrics, and the
configured RSS feeds and pause state. It does not expose tokens, conversation
content, or Discord server-management controls.

The console is intentionally disabled by default and rejects non-local bind
addresses. Discord commands remain the operational fallback. Safe RSS preview,
pause/resume, and audited configuration writes are planned follow-up work.
