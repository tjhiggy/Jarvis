# RSS native Discord cards

RSS broadcasts post each new allowlisted feed entry as one bot-authored Discord
message. The Discord message is the native card: linked title, source as author,
and image when the feed provided one. Jarvis does not set
`MessageFlags.SuppressEmbeds`. Content stays empty so the card is the only
visible surface and Discord does not also unfurl a text-wall preview. A
SuppressEmbeds-plus-empty-content payload is a blank post and must stay rejected.

## Sub-features

- `rss-digest-card` sends one embed per headline: linked title, optional feed image, source as author.
- `rss-digest-native-embeds` omits `MessageFlags.SuppressEmbeds` so Discord can render that card.
- `rss-digest-minimal-content` keeps `content` empty so the post is not a text wall and does not double-unfurl.
- `rss-digest-mentions` sends `allowedMentions.parse` as an empty list so the post cannot ping roles or everyone.
- `rss-digest-bound` keeps oversized entries from becoming a post and omits invalid images instead of attaching a broken image.
- `rss-digest-one-per-tick` publishes at most one headline per five-minute tick.
- `rss-digest-catch-up-window` skips items older than two hours, and skips items with no usable published/available timestamp.

## How to get to it (user POV)

- An administrator adds an allowlisted HTTPS feed with `/rss` (or the Command Deck RSS controls).
- Jarvis later posts new entries to the configured RSS channel.
- Crew members see one native Discord card per headline. They do not run a verify command.

## Driving it with the Jarvis CI harness

Preconditions:

- Doctor has passed.
- `node_modules/.bin/vitest` exists.
- No Discord token is in the environment.

- **Blank-post reject.** Prove SuppressEmbeds plus empty content is invisible. Run `npm test -- tests/rss-scheduler.test.ts --reporter=verbose`. The test `rejects empty content when SuppressEmbeds would hide the only RSS card` expects `rssBroadcastShowsItem` to be false for an embed-only `SuppressEmbeds` payload and for title-only content, and true for an unsuppressed embed that has title and URL.
- **Visible native card.** In the same file, the test `sends a native Discord card with visible title and link and no SuppressEmbeds` expects one payload per entry. Each payload `content` is empty and has no `flags`. The IGN payload `embeds[0]` has `title` `Update gta-apartment`, `url` `https://news.example.com/gta-apartment`, `author.name` `IGN`, and `image.url` `https://cdn.example.com/gta-apartment.jpg`. The PC Gamer payload has title, url, and author, and does not have `image`. `rssBroadcastShowsItem` is true for both.
- **No suppress embeds.** In the same test, neither payload has `flags`, and the serialized payloads do not include `MessageFlags.SuppressEmbeds`.
- **Mention lock.** In the same test, `payload.allowedMentions` equals `{ parse: [], repliedUser: false }`.
- **Bounded payload.** The test `keeps every rendered digest entry complete within the payload bound` stays in the same file and must pass with an empty-content native card.
- **One per tick.** The test `publishes at most one new entry per tick` expects one `publish` call on the first tick and a second call only on the next tick.
- **Catch-up window.** The tests `does not publish catch-up items older than two hours`, `publishes a catch-up item that is still within two hours`, and `skips catch-up items with no usable published time` must pass.
- **Driver.** Equivalent one-shot: `.cursor/skills/verify-jarvis/scripts/drive-feature.sh rss-digest`.
- **Proof.** Exit code `0`. Artifact `.cursor/skills/verify-jarvis/artifacts/rss-digest/verify.txt` contains the native-card and blank-post reject test names and a passing Vitest summary.

## Gotchas

- This is not a live `/rss` in GAMING-BRO. A guild post is out of scope even if you have operator access.
- `tests/rss-command.test.ts` and `tests/rss-notifications.test.ts` are related. The notifications file proves feed-image parsing; it does not replace the scheduler payload assertions.
- `npm run register-commands` does not prove digest flags. Doctor must refuse that intent.
- Do not start Jarvis to "watch the next tick." `RssScheduler` is driven in-process by the test file.
- Do not scrape live IGN pages. Cards use already-parsed RSS fields, including `imageUrl` when the feed provided a public HTTPS image.
