# Task 7 report: events and RSVP

Implemented the event slice only. Recaps and trivia were deliberately left out.

- `/event create`, `list`, `details`, and `cancel` are registered; creation and cancellation require a configured engagement administrator role.
- Event times accept an IANA timezone and `YYYY-MM-DD HH:mm` local time, persist the UTC instant plus timezone label, and reject nonexistent, ambiguous, past, or invalid ranges.
- Event cards provide yes, maybe, no, and explicit `Yes + reminder` controls. No role or mass mention is used.
- SQLite RSVP writes choose confirmed or waitlisted attendance atomically. A confirmed attendee changing away from yes promotes the oldest waitlisted yes RSVP.
- Event cards record unavailable destinations safely. The scheduler only selects explicit reminder opt-ins and records delivered or failed outcomes so restart retries are bounded and durable.
- Event records and their RSVPs remain under the configured engagement cleanup policy.

Verification: focused event tests, engagement storage tests, command-registration tests, full test suite, TypeScript build, documentation validation, and diff whitespace checks.
