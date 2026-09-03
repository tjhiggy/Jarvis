# RSS visible title and link with SuppressEmbeds

RSS broadcasts post each new allowlisted feed entry as one bot-authored Discord
message. The payload always includes the title and a working link in `content`.
Jarvis keeps `MessageFlags.SuppressEmbeds` so Discord does not unfurl a second
headline card beside that text. SuppressEmbeds must not be the only visible
surface: an embed-only payload is a blank post.

## Sub-features

- `rss-digest-content` sends title and URL in `content` so the post stays visible when embeds are suppressed.
- `rss-digest-card` still includes one embed per headline: linked title, optional feed image, source as author.
- `rss-digest-suppress-embeds` sets `flags` to `MessageFlags.SuppressEmbeds` only after `content` already has title and link.
- `rss-digest-mentions` sends `allowedMentions.parse` as an empty list so the post cannot ping roles or everyone.
- `rss-digest-bound` keeps oversized entries from becoming a post and omits invalid images instead of attaching a broken image.
- `rss-digest-split` publishes one Discord message per retained item so a cycle of several headlines is several posts, not one text dump.

## How to get to it (user POV)

- An administrator adds an allowlisted HTTPS feed with `/rss` (or the Command Deck RSS controls).
- Jarvis later posts new entries to the configured RSS channel.
- Crew members see the title and a working link for each headline. They do not run a verify command.

## Driving it with the Jarvis CI harness

Preconditions:

- Doctor has passed.
- `node_modules/.bin/vitest` exists.
- No Discord token is in the environment.

- **Blank-post reject.** Prove empty content fails. Run `npm test -- tests/rss-scheduler.test.ts --reporter=verbose`. The test `rejects empty content when SuppressEmbeds would hide the only RSS card` expects `rssBroadcastShowsItem` to be false for an embed-only `SuppressEmbeds` payload and for title-only content, and true for an unsuppressed embed that has title and URL.
- **Visible content.** In the same file, the test `sends title and link in content so SuppressEmbeds cannot blank the RSS post` expects one payload per entry. Each payload `content` includes the source label, title, and URL. The IGN payload `embeds[0]` has `title` `Update gta-apartment`, `url` `https://news.example.com/gta-apartment`, `author.name` `IGN`, and `image.url` `https://cdn.example.com/gta-apartment.jpg`. The PC Gamer payload has title, url, and author, and does not have `image`. `rssBroadcastShowsItem` is true for both.
- **Suppress embeds.** In the same test, each payload `flags` equals `MessageFlags.SuppressEmbeds` and `content` still contains the title and URL.
- **Mention lock.** In the same test, `payload.allowedMentions` equals `{ parse: [], repliedUser: false }`.
- **Bounded payload.** The test `keeps every rendered digest entry complete within the payload bound` stays in the same file and must pass with visible title-and-link content.
- **Split messages.** The test `publishes at most five new entries in one source-labelled digest` expects five `publish` calls, one entry each.
- **Driver.** Equivalent one-shot: `.cursor/skills/verify-jarvis/scripts/drive-feature.sh rss-digest`.
- **Proof.** Exit code `0`. Artifact `.cursor/skills/verify-jarvis/artifacts/rss-digest/verify.txt` contains the visible-content and blank-post reject test names and a passing Vitest summary.

## Gotchas

- This is not a live `/rss` in GAMING-BRO. A guild post is out of scope even if you have operator access.
- `tests/rss-command.test.ts` and `tests/rss-notifications.test.ts` are related. The notifications file proves feed-image parsing; it does not replace the scheduler payload assertions.
- `npm run register-commands` does not prove digest flags. Doctor must refuse that intent.
- Do not start Jarvis to "watch the next tick." `RssScheduler` is driven in-process by the test file.
- Do not scrape live IGN pages. Cards use already-parsed RSS fields, including `imageUrl` when the feed provided a public HTTPS image.
