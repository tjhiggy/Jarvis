# RSS digest SuppressEmbeds

RSS broadcasts post a public digest of new allowlisted feed entries. Jarvis sends the digest as message content with `MessageFlags.SuppressEmbeds` so Discord does not unfurl a second headline card beside the formatted links.

## Sub-features

- `rss-digest-render` formats each retained entry as source, title, and URL in the digest body.
- `rss-digest-suppress-embeds` sets `flags` to `MessageFlags.SuppressEmbeds` and omits an `embeds` property.
- `rss-digest-mentions` sends `allowedMentions.parse` as an empty list so the digest cannot ping roles or everyone.
- `rss-digest-bound` keeps oversized entries from breaking the payload bound.

## How to get to it (user POV)

- An administrator adds an allowlisted HTTPS feed with `/rss` (or the Command Deck RSS controls).
- Jarvis later posts new entries to the configured RSS channel as a digest.
- Crew members see the digest in that channel. They do not run a verify command.

## Driving it with the Jarvis CI harness

Preconditions:

- Doctor has passed.
- `node_modules/.bin/vitest` exists.
- No Discord token is in the environment.

- **Digest body.** Prove the formatted entries. Run `npm test -- tests/rss-scheduler.test.ts`. The test `sends RSS digest URLs with SuppressEmbeds so Discord does not unfurl a second headline card` expects `payload.content` to contain `**IGN** · Update gta-apartment` and `**PC Gamer** · Update elden-ring` with their `https://news.example.com/...` URLs.
- **Suppress embeds.** In the same test, `payload.flags` equals `MessageFlags.SuppressEmbeds` and `payload` does not have `embeds`.
- **Mention lock.** In the same test, `payload.allowedMentions` equals `{ parse: [], repliedUser: false }`.
- **Bounded payload.** The test `keeps every rendered digest entry complete within the payload bound` stays in the same file and must pass with the SuppressEmbeds case.
- **Driver.** Equivalent one-shot: `.cursor/skills/verify-jarvis/scripts/drive-feature.sh rss-digest`.
- **Proof.** Exit code `0`. Artifact `.cursor/skills/verify-jarvis/artifacts/rss-digest/verify.log` contains the SuppressEmbeds test name and a passing Vitest summary.

## Gotchas

- This is not a live `/rss` in GAMING-BRO. A guild post is out of scope even if you have operator access.
- `tests/rss-command.test.ts` and `tests/rss-notifications.test.ts` are related but do not assert `SuppressEmbeds` on the digest send payload. Do not substitute them for this feature.
- `npm run register-commands` does not prove digest flags. Doctor must refuse that intent.
- Do not start Jarvis to "watch the next tick." `RssScheduler` is driven in-process by the test file.
