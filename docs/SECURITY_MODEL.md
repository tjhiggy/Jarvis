# Security Model

Jarvis is a proprietary advisory bot. It is not a moderator, administrator,
automation agent, or general-purpose execution environment. The controls below
describe implemented source behavior; proposals are labelled as planned.

## Protected assets

- Discord bot token, OpenAI API key, and Tavily API key.
- Discord application, guild, channel, and user identifiers.
- Bot-owned SQLite conversation history, including prompts and successful
  assistant responses, plus backups of that database.
- Trusted operator configuration and persona content.
- Provider account availability, budget, rate limits, and model access.
- The integrity of Jarvis's deployment, source revision, and command set.

The application does not encrypt SQLite data itself. Protect the host, Docker
volume, native database directory, and backups accordingly.

## Trust boundaries

Discord gateway events, slash-command text, mentions, and search results are
untrusted input. They cannot select configuration or persona paths, grant
authority, or replace system instructions. The trusted persona is loaded from
an operator-configured local file at startup and is bounded to 8,000 Unicode
characters. Configuration comes from the deployment environment, not Discord.

OpenAI, Ollama, and Tavily sit beyond the process boundary. Sending a prompt to
the configured provider shares it with that provider. Tavily results are
treated as untrusted evidence, not instructions. Docker administrators can
inspect container environment values, so a production deployment should use the
platform's approved secret-management boundary.

## Implemented controls

- **Channel access.** `ALLOWED_CHANNEL_IDS` gates `/ask`, `/search`,
  `/forget`, and mention handling; an allowlisted parent permits its threads.
  Empty means every otherwise accessible server channel, so explicit production
  allowlists are recommended.
- **Discord permission checks.** Mention replies require View Channel, Read
  Message History, and Send Messages, or Send Messages in Threads for threads.
  The client requests only Guilds and Guild Messages gateway intents.
- **Input and concurrency bounds.** Prompts have a configured character limit,
  history and stored rows are bounded, duplicate events are suppressed, and
  rate limits apply per guild and user.
- **Data separation.** History is isolated by guild and channel or thread.
  `/forget` removes only Jarvis-owned history for the current conversation;
  retention cleanup removes old bot-owned rows.
- **Provider safeguards.** Both adapters use configured timeouts and bounded
  retries. OpenAI requests set `store: false`; provider errors map to generic
  user-facing failures.
- **Mass-mention protection.** Replies set Discord `allowedMentions` to an
  empty parse list with `repliedUser: false`, and text is neutralized before
  delivery. Jarvis cannot turn an answer into an `@everyone` incident.
- **Credential redaction.** Structured logs redact token, API-key, and
  authorization-shaped fields, including nested headers. Error projection keeps
  safe class/category/code metadata rather than error messages, stacks, content,
  or secret values.
- **Database safety.** SQLite uses parameterized statements, WAL mode,
  foreign-key enforcement, and a five-second busy timeout.

## Safety identifier

For OpenAI requests, the service hashes the supplied safety identifier before
sending it. Current application wiring derives the identifier from the OpenAI
key when it is present, otherwise the Discord token, then hashes it with guild
and user identifiers before the provider adapter hashes the final value again.
No raw credential is intentionally placed in the outbound safety-identifier
field.

**Planned hardening, not implemented:** add a dedicated
`SAFETY_IDENTIFIER_SECRET` configuration value, keep it in the secret manager,
and use it solely for identifier derivation. This needs a reviewed code,
configuration, example-file, and test change. It must not be claimed as a
current setting.

## Prohibited capabilities and administration policy

This release has no contract or code path for arbitrary shell or code execution,
arbitrary file access, Discord server administration, deleting or editing other
members' content, GitHub writes, external tool invocation, or autonomous
learning. The persona cannot grant those powers. Future extension interfaces are
deliberately inert and disabled.

Jarvis makes ordinary delivery edits to its own deferred interaction reply, and
an operator-run command-registration script bulk-overwrites this application's
guild command definitions. Neither is general server administration. All
administrative changes must be deliberate, operator-authorized, scoped to the
named system, and non-destructive by default. Do not turn a support request into
an unreviewed change to Discord, source control, or production data.

## External-service risks

OpenAI and Tavily may be unavailable, rate limited, or incur charges. Model
availability and billing are provider-controlled. Local Ollama trades external
API exposure for local host, disk, CPU/GPU, and network exposure risks. Search
content and model output can be inaccurate or adversarial. Treat all generated
guidance as advisory, validate important claims independently, and do not let
retrieved content become an instruction channel.
