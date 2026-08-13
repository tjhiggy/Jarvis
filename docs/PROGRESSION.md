# Progression and economy foundation

v1.4 establishes a server-scoped progression contract covering coins,
inventory, rewards, trading, achievements, XP, voice XP, leaderboards, and
custom titles. The projection is aggregate-safe and bounded. It never exposes
message content, private conversation history, or uncontrolled member data.

Each feature remains independently gated. Opt-out and deletion must remove the
member's retained progression data. The Command Deck may show aggregate totals;
Discord remains the immediate member interaction surface until a later Sites
control-plane migration.
