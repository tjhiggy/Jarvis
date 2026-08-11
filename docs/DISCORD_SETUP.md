# Discord setup

This guide configures the Discord resources Jarvis actually uses. The bot is advisory only: it responds to direct mentions and the registered slash commands; it does not administer a server, manage content, alter roles, or create webhooks.

## Create the application and bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create an application.
2. On **General Information**, copy the Application ID into local `.env` as `DISCORD_CLIENT_ID`.
3. On **Bot**, create or use the bot user and store its token as `DISCORD_TOKEN` in a secret manager or ignored `.env` file. Treat the token as a password.
4. Set `DISCORD_GUILD_ID` to a server you are authorized to use for development command registration.

For a single-server installation, configure the application as a private bot in the Developer Portal and install it only into the intended server. Private installation is an operational choice in Discord's portal, not a runtime permission granted by this repository. Review the installation audience and requested scopes before authorizing it.

## Gateway intents and minimum permissions

The code requests only the nonprivileged `Guilds` and `GuildMessages` gateway intents. Polls use interactions and buttons through the same connection; they require no new intent. Do **not** enable the privileged Message Content, Presence, or Server Members intents for this application. Jarvis processes a message only when it directly mentions the bot, and it ignores bot-authored messages and direct messages.

Grant only the permissions used by the Discord adapter in the channels where Jarvis operates:

- **View Channel**
- **Read Message History**
- **Send Messages** for normal channels
- **Send Messages in Threads** when using threads
- **Embed Links** for the optional poll interface

Engagement does not require another gateway intent or a broad server
permission. For each non-blank `ENGAGEMENT_*_CHANNEL_ID`, grant **View
Channel**, **Read Message History**, **Send Messages**, and **Embed Links** only
in that exact channel. Jarvis uses buttons on messages it owns; Discord has no
separate bot permission for buttons. Do not grant access to general channels
for recap or engagement discovery, because future engagement handlers must use
only their explicitly configured destinations.

Users invoking commands also need Discord's **Use Application Commands** access where their role and channel overrides apply. Do not grant Administrator, Manage Channels, Manage Roles, Manage Messages, moderation, webhook, or other unimplemented powers. The bot cannot use them, and granting them is security theater with teeth.

## Install URL

Use Discord's OAuth2 URL Generator to select the `bot` and `applications.commands` scopes, add only the minimum permissions above, and let the portal calculate the permission integer. Substitute your own values into this template:

```text
https://discord.com/oauth2/authorize?client_id=YOUR_DISCORD_CLIENT_ID&scope=bot%20applications.commands&permissions=CALCULATED_MINIMUM_PERMISSION_INTEGER
```

Open the completed URL, select the intended server, inspect the requested permissions, and authorize. Do not replace the calculated value with an Administrator integer because a blog post had opinions.

## Channel access and threads

Configure an explicit channel allowlist for a narrowly scoped installation:

```dotenv
ALLOWED_CHANNEL_IDS=YOUR_CHANNEL_ID,ANOTHER_CHANNEL_ID
RESTRAINED_CHANNEL_IDS=YOUR_TECHNICAL_CHANNEL_ID
```

An empty `ALLOWED_CHANNEL_IDS` permits all guild channels where the bot has the required permissions. A listed parent channel allows its threads. Each thread still has separate conversation history because its thread ID is its conversation identifier. `RESTRAINED_CHANNEL_IDS` changes persona tone only; it does not grant or remove access.

Engagement has narrower channel settings and does not inherit this broad
allowlist as permission to read every allowed channel. Leave
`ENGAGEMENT_ENABLED=false` until each required engagement destination and the
administrator role allowlist are configured.

## Register development-guild commands

After creating `.env` and installing dependencies, register the definitions in the configured development guild:

```powershell
npm run register-commands
```

The script sends the complete current command set to Discord's guild-command route for `DISCORD_CLIENT_ID` and `DISCORD_GUILD_ID`. Treat it as an operator action: it replaces only this application's registered commands in that guild with the set in `src/commands/definitions.ts`. It does not affect commands owned by other applications, roles, channels, permissions, messages, or server settings. When both poll credentials are configured, the set also includes `/poll` and `/poll-close`; otherwise those two optional commands are omitted.

Global registration is not implemented as a runtime toggle. It is a future, manual deployment change: review and intentionally change the route in `scripts/register-commands.ts` from `Routes.applicationGuildCommands` to `Routes.applicationCommands`, test it, then register deliberately. Do not register both scopes casually; guild commands are the development-safe path.

## Commands

| Command                | Behavior                                                                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/ask prompt:<text>`   | Sends a bounded prompt to the selected provider with history from the current channel or thread.                                                        |
| `/search query:<text>` | Requires `TAVILY_API_KEY`; grounds the question with current Tavily results before the provider answers.                                                |
| `/forget`              | Deletes Jarvis's stored history for the current guild channel or thread and responds ephemerally.                                                       |
| `/channel-summary`     | Privately summarizes retained Jarvis conversation from the last 24 hours in the current channel or thread; it does not fetch arbitrary Discord history. |
| `/faq`                 | Lists approved local FAQ questions publicly or returns the selected exact approved answer.                                                              |
| `/help`                | Lists the available commands and safety boundary in an ephemeral server-channel response.                                                               |
| `/status`              | Reports safe configuration, FAQ readiness, SQLite health, and safe reminder health ephemerally without a model request.                                 |
| `/config`              | Administrator-only ephemeral view of non-secret effective configuration. Destination IDs are masked; credentials and message content are omitted.       |
| `/reminder set`        | Privately creates a personal 1-minute to 30-day reminder with up to 500 characters; delivery returns to this allowed channel or thread.                 |
| `/reminder list`       | Privately lists only the caller's retained reminders in this server.                                                                                    |
| `/reminder cancel`     | Privately cancels only the caller's active reminder by ID.                                                                                              |
| `/poll`                | Configured administrator IDs create a public anonymous two-to-five-option poll using a fixed duration preset.                                           |
| `/poll-close`          | Configured administrator IDs close an open poll early by poll ID.                                                                                       |
| `/fantasy standings`   | Reads the configured Sleeper league's standings and display names. Read-only; pre-draft unassigned rosters are shown safely.                            |
| `/fantasy player`      | Reads bounded, read-only statistics for one explicitly requested Sleeper player and season, optionally one week.                                        |

`/ask`, `/search`, `/forget`, `/faq`, `/reminder`, `/poll`, and `/poll-close` enforce the channel allowlist. Reminder commands do not need an administrator ID or extra Discord permissions; scheduled delivery may mention only its verified owner. Poll command creation and early closure additionally require an exact ID in `POLL_ADMIN_USER_IDS`; voting is open to members who can use the poll message. All commands are server-only; direct messages receive a safe unavailable response. Direct mentions require a non-empty prompt after the bot mention.

If `/reminder list` shows `destination access denied`, an administrator should
verify Jarvis has **View Channel**, **Send Messages**, and **Embed Links** in the
target channel. Thread reminders also require **Send Messages in Threads** on
the parent channel, and the channel or parent must remain allowlisted. A
`destination unavailable` result means the channel was deleted or is no longer
available; create a new reminder in an active allowed channel. These permanent
failures are not retried, which prevents duplicate posts.

Continue with [Configuration](CONFIGURATION.md) and [Development](DEVELOPMENT.md).

Use the [Engagement runbook](ENGAGEMENT_RUNBOOK.md) for exact per-channel
scopes, feature commands, scheduler behavior, deletion, and recovery.
