# Stream notifications

Jarvis provides a bounded, read-only foundation for optional YouTube and Twitch notifications. It polls explicitly configured feeds and posts new links only to a configured Discord channel.

Safety boundaries:

- Disabled unless a destination and feeds are configured.
- At most 20 feeds and 5 new items per feed are processed per poll.
- Network requests have timeouts and provider failures are suppressed as safe user-facing errors.
- Idempotency keys prevent duplicate posts across polls.
- Jarvis never creates webhooks, writes to YouTube/Twitch, or accepts arbitrary URLs.
- Twitch credentials are optional and are required only when Twitch feeds are enabled.

The provider client is intentionally separated from the store and Discord publisher so a durable SQLite store and a scheduler can be added without widening access. Feed discovery, arbitrary webhooks, and moderation are out of scope for this foundation.
