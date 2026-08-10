# Per-MuthaShip feature flags

Jarvis stores feature overrides per Discord server (MuthaShip) in SQLite. Every
supported feature is enabled by default, so existing installations keep their
current behavior after upgrading. An override is only an enable/disable value
for a known feature name; it cannot alter Discord roles, channels, permissions,
or other server settings.

Supported names are `introductions`, `suggestions`, `events`, `trivia`,
`birthdays`, `roles`, `proactive`, and `recaps`.

The storage interface is intentionally small (`getFeatureFlags` and
`setFeatureFlag`) so the database can later be replaced with PostgreSQL. Admin
command wiring should use the configured administrator role allowlist and must
never expose secrets or permit arbitrary flag names.
