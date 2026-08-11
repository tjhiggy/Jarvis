# Per-MuthaShip feature flags

Jarvis stores feature overrides per Discord server (MuthaShip) in SQLite.
Existing features are enabled by default so installations keep their current
behavior after upgrading. New member profiles are disabled by default. An override is only an enable/disable value
for a known feature name; it cannot alter Discord roles, channels, permissions,
or other server settings.

Supported names are `introductions`, `suggestions`, `events`, `trivia`,
`birthdays`, `roles`, `proactive`, `recaps`, and `profiles`.

Configured administrators use `/engagement feature action:status name:profiles`
to inspect the effective state, then `action:enable` or `action:disable` to
change it for one MuthaShip. Disabling profiles preserves stored records so an
administrator can pause access without silently deleting member data.

The storage interface is intentionally small (`getFeatureFlags` and
`setFeatureFlag`) so the database can later be replaced with PostgreSQL. Admin
command wiring should use the configured administrator role allowlist and must
never expose secrets or permit arbitrary flag names.
