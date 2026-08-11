# Connected Systems provider contract

The v0.8 Connected Systems layer uses a shared read-only provider contract so
every external adapter has the same safety boundary before it reaches Jarvis.

Each provider declares a stable ID and version and exposes a health check. The
registry returns only an allowlisted health projection: provider ID, version,
state, and a short operator-safe detail. Credentials, response bodies, URLs,
and arbitrary error text are never returned by the registry.

Provider adapters must keep their endpoints and HTTP methods fixed in code.
User input may select a bounded operation, but it may not supply an arbitrary
URL, method, header, or external destination. Providers must enforce timeouts,
response bounds, feature flags, server scope, and safe unavailable or
rate-limited errors before any request leaves the MuthaShip.

The first implementation slice is intentionally a contract and health
boundary. Sleeper, GitHub, RSS, and future MCP adapters migrate onto it
incrementally. Existing Discord commands remain available during migration.

## Release and rollback

Provider changes ship behind their existing configuration and feature flags.
If an adapter misbehaves, pause or disable that provider, verify the safe
unavailable response, and roll back the adapter release without changing
Discord permissions or external data. No provider in this layer may create,
edit, or delete an external resource.
