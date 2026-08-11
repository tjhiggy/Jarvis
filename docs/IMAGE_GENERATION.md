# Controlled image generation

Jarvis 0.7 includes an optional administrator-only image boundary. It is
disabled by default, uses an explicit OpenAI image model, and can post only in
one configured Discord channel.

## Operator setup

1. Set `IMAGE_GENERATION_ENABLED=true`.
2. Set `IMAGE_GENERATION_CHANNEL_ID` to the approved destination.
3. Keep `OPENAI_API_KEY` in the local secret environment.
4. Select the explicit `IMAGE_GENERATION_MODEL` and restart Jarvis.
5. Reregister Discord commands, then use
   `/image generate prompt:<description>` in that channel with an approved
   administrator role.

## Boundaries

- One image per request, at most 10 MB.
- Prompt length is 20 through 1,000 characters.
- Mass mentions and role mentions are rejected.
- Prompts and generated image bytes are not written to SQLite or logs.
- Unauthorized users and other channels receive a private denial.
- Disabled or unavailable providers return a safe response and post no image.

Disable the feature and restart Jarvis for the immediate rollback path. The
existing files and other Community Intelligence features are unaffected.
