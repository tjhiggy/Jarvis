# Delegated MuthaShip transmissions

Administrators can use `/post preview` to draft a message for the configured activity/test channel. Jarvis shows a private preview with explicit Confirm and Cancel actions. Confirming posts a branded `MuthaShip transmission` card with the requesting member attributed in the card. The card is not presented as a Discord system message and mentions are neutralized.

V1 is intentionally bounded: only configured administrator roles may use it, content is limited to 1,500 characters, previews expire after 15 minutes, duplicate drafts are rejected, and the destination is the configured engagement activity channel. No server settings or arbitrary channels are modified.

`/post` is configured when the activity/test channel and administrator roles are present. It does not require a separate engagement master switch. If a slash-command interaction omits `guildId` (direct message, user-install, or otherwise missing guild context), Jarvis uses the configured Discord guild. Fail-closed "not configured" replies occur only when that destination or the administrator role allowlist is missing. User-facing errors never include tokens, secrets, or channel IDs.
