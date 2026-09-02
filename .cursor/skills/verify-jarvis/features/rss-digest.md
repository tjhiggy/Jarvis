# RSS native cards with SuppressEmbeds

RSS broadcasts post each new allowlisted feed entry as one bot-authored Discord
card. Jarvis keeps `MessageFlags.SuppressEmbeds` so Discord does not unfurl a
second headline card beside the embed.

## Sub-features

- `rss-digest-card` sends one embed per headline: linked title, optional feed image, source as author.
- `rss-digest-suppress-embeds` sets `flags` to `MessageFlags.SuppressEmbeds` and includes the bot-authored `embeds` property.
- `rss-digest-mentions` sends `allowedMentions.parse` as an empty list so the card cannot ping roles or everyone.
- `rss-digest-bound` keeps oversized entries from becoming a card and omits invalid images instead of attaching a broken image.
- `rss-digest-split` publishes one Discord message per retained item so a cycle of several headlines is several cards, not one text dump.

## How to get to it (user POV)

- An administrator adds an allowlisted HTTPS feed with `/rss` (or the Command Deck RSS controls).
- Jarvis later posts new entries to the configured RSS channel as native cards.
- Crew members see one card per headline in that channel. They do not run a verify command.

## Driving it with the Jarvis CI harness

Preconditions:

- Doctor has passed.
- `node_modules/.bin/vitest` exists.
- No Discord token is in the environment.

- **Native card.** Prove the embed. Run `npm test -- tests/rss-scheduler.test.ts --reporter=verbose`. The test `sends one native Discord card per headline with SuppressEmbeds so Discord does not unfurl a second card` expects one payload per entry. The IGN payload `embeds[0]` has `title` `Update gta-apartment`, `url` `https://news.example.com/gta-apartment`, `author.name` `IGN`, and `image.url` `https://cdn.example.com/gta-apartment.jpg`. The PC Gamer payload has title, url, and author, and does not have `image`.
- **Suppress embeds.** In the same test, each payload `flags` equals `MessageFlags.SuppressEmbeds` and the payload does not have `content`.
- **Mention lock.** In the same test, `payload.allowedMentions` equals `{ parse: [], repliedUser: false }`.
- **Bounded payload.** The test `keeps every rendered digest entry complete within the payload bound` stays in the same file and must pass with the native-card case.
- **Split messages.** The test `publishes at most five new entries in one source-labelled digest` expects five `publish` calls, one entry each.
- **Driver.** Equivalent one-shot: `.cursor/skills/verify-jarvis/scripts/drive-feature.sh rss-digest`.
- **Proof.** Exit code `0`. Artifact `.cursor/skills/verify-jarvis/artifacts/rss-digest/verify.txt` contains the native-card SuppressEmbeds test name and a passing Vitest summary.

## Gotchas

- This is not a live `/rss` in GAMING-BRO. A guild post is out of scope even if you have operator access.
- `tests/rss-command.test.ts` and `tests/rss-notifications.test.ts` are related. The notifications file proves feed-image parsing; it does not replace the scheduler payload assertions.
- `npm run register-commands` does not prove digest flags. Doctor must refuse that intent.
- Do not start Jarvis to "watch the next tick." `RssScheduler` is driven in-process by the test file.
- Do not scrape live IGN pages. Cards use already-parsed RSS fields, including `imageUrl` when the feed provided a public HTTPS image.
