# Jarvis Discord profile package

This is the canonical profile package for the MuthaShip Jarvis Discord application.

## Recommended public profile

**Display name**

`Muthaship Jarvis`

**Short bio**

`The MuthaShip's AI copilot: answers questions, guides crew introductions, supports events, and keeps shipboard operations informed.`

**Application description**

`Muthaship Jarvis is a privacy-conscious Discord AI copilot for the MuthaShip. Ask questions by mention or slash command, use guided crew introductions, collect suggestions, run lightweight events and trivia, choose optional allowlisted crew roles, and review read-only fantasy standings. Jarvis stores only the bounded data required for these features, does not moderate the server, and does not create or manage arbitrary roles, channels, repositories, or server settings.`

**Support text**

`For setup, operations, security boundaries, and troubleshooting, see the project documentation and GitHub issue tracker.`

## Visual assets

- Avatar: [`assets/jarvis-discord-icon.png`](../assets/jarvis-discord-icon.png)
- Banner: [`assets/jarvis-discord-banner.png`](../assets/jarvis-discord-banner.png)
- Community platform overview: [`assets/jarvis-admin-overview-infographic-v3.png`](../assets/jarvis-admin-overview-infographic-v3.png)

Upload the avatar and banner through the Discord Developer Portal. Do not commit a token, private invite, or machine-specific screenshot.

## Developer Portal checklist

1. Confirm the application name and bot display name use `Muthaship Jarvis` consistently.
2. Upload the approved avatar and banner assets.
3. Use the short bio and application description above.
4. Keep the bot private unless the owner intentionally changes the distribution model.
5. Use only the `bot` and `applications.commands` OAuth2 scopes.
6. Grant only the documented channel-scoped permissions from [Discord setup](DISCORD_SETUP.md).
7. Keep privileged intents disabled. Jarvis needs only the nonprivileged gateway intents documented in the setup guide.
8. Review the command descriptions after every registration change.
9. Verify the generated install URL before sharing it. Never paste a token or secret into profile fields.

## Capability boundary

Public copy must not imply that Jarvis can execute code, change server settings, broadly write to GitHub, manage roles, moderate members, or learn from conversations as a training loop. Jarvis can only create a labeled issue in one configured repository through the administrator-confirmed `/feature-request` workflow.

## Manual verification record

After portal changes, verify the bot profile from both desktop and mobile Discord clients. Check the name, avatar, banner, bio, command list, install flow, and support links. Record the date and the application version in the release notes.
