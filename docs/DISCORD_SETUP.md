# Discord setup

This guide configures the Discord resources Jarvis actually uses. The bot is advisory only: it responds to direct mentions and the registered slash commands; it does not administer a server, manage content, alter roles, or create webhooks.

## Create the application and bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create an application.
2. On **General Information**, copy the Application ID into local `.env` as `DISCORD_CLIENT_ID`.
3. On **Bot**, create or use the bot user and store its token as `DISCORD_TOKEN` in a secret manager or ignored `.env` file. Treat the token as a password.
4. Set `DISCORD_GUILD_ID` to a server you are authorized to use for development command registration.

For a single-server installation, configure the application as a private bot in the Developer Portal and install it only into the intended server. Private installation is an operational choice in Discord's portal, not a runtime permission granted by this repository. Review the installation audience and requested scopes before authorizing it.

## Gateway intents and minimum permissions

The code requests only the nonprivileged `Guilds` and `GuildMessages` gateway intents. Do **not** enable the privileged Message Content, Presence, or Server Members intents for this application. Jarvis processes a message only when it directly mentions the bot, and it ignores bot-authored messages and direct messages.

Grant only the permissions used by the Discord adapter in the channels where Jarvis operates:

- **View Channel**
- **Read Message History**
- **Send Messages** for normal channels
- **Send Messages in Threads** when using threads

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

## Register development-guild commands

After creating `.env` and installing dependencies, register the definitions in the configured development guild:

```powershell
npm run register-commands
```

The script sends the complete current command set to Discord's guild-command route for `DISCORD_CLIENT_ID` and `DISCORD_GUILD_ID`. Treat it as an operator action: it replaces this application's registered commands in that guild with the set in `src/commands/definitions.ts`. It does not affect commands owned by other applications.

Global registration is not implemented as a runtime toggle. It is a future, manual deployment change: review and intentionally change the route in `scripts/register-commands.ts` from `Routes.applicationGuildCommands` to `Routes.applicationCommands`, test it, then register deliberately. Do not register both scopes casually; guild commands are the development-safe path.

## Commands

| Command                | Behavior                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `/ask prompt:<text>`   | Sends a bounded prompt to the selected provider with history from the current channel or thread.         |
| `/search query:<text>` | Requires `TAVILY_API_KEY`; grounds the question with current Tavily results before the provider answers. |
| `/forget`              | Deletes Jarvis's stored history for the current guild channel or thread and responds ephemerally.        |
| `/faq`                 | Lists approved local FAQ questions publicly or returns the selected exact approved answer.               |
| `/help`                | Lists the available commands and safety boundary in an ephemeral server-channel response.                |
| `/status`              | Reports safe configuration, FAQ readiness, and SQLite health ephemerally without making a model request. |

`/ask`, `/search`, `/forget`, and `/faq` enforce the channel allowlist. All commands are server-only; direct messages receive a safe unavailable response. Direct mentions require a non-empty prompt after the bot mention.

Continue with [Configuration](CONFIGURATION.md) and [Development](DEVELOPMENT.md).
