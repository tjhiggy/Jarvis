# Private support tickets

Issue #57 is designed as a deliberately narrow support workflow. The service contract is ready for Discord delivery, but the Discord channel/thread adapter remains a separate rollout step.

## Safety contract

- Tickets are enabled only when an administrator configures one support channel.
- A member may have one open ticket by default.
- The ticket subject is bounded and treated as untrusted text.
- Only the requester or a configured administrator can close a ticket.
- The bot must never grant roles, change server settings, or create arbitrary channels.
- A future Discord adapter should create a private thread under the configured channel, grant visibility only to the requester and configured support administrators, and remove access on close.
- Ticket messages and transcripts require an explicit retention period and deletion job before production enablement.

The current `SupportTicketService` and repository interface provide the persistence and authorization boundary without silently adding Discord mutation authority. The next implementation step is a reviewed Discord gateway adapter with explicit permissions and integration tests.
