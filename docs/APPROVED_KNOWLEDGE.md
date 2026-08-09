# Approved MuthaShip knowledge

Jarvis must never be trained on, or silently ingest, every Discord message. The approved-knowledge boundary is retrieval-only: an administrator explicitly approves a source, and Jarvis may answer from that source until its retention window expires.

The catalog helper in `src/knowledge/approved-knowledge.ts` enforces the safe part of that boundary:

- unapproved entries are excluded;
- entries past `retentionDays` are excluded;
- content is redacted for API tokens, email addresses, and mass mentions before indexing;
- results retain a source label and update timestamp for attribution;
- the catalog returns at most five matching results and never reads arbitrary paths.

The current V1 production source remains the checked-in catalog. Administrators can use `/knowledge list` to see every configured source and whether it is pending, active, or expired, then `/knowledge approve id:<id>` or `/knowledge revoke id:<id>` to set a per-server approval override. `/knowledge query` searches only active entries and returns source attribution. These commands are read-only with respect to Discord and cannot create roles, change permissions, or write to GitHub.

Channel and thread ingestion, administrator preview/approval UI for new content, member removal requests, and audit records are deliberately separate follow-up work. They must be implemented before Discord content is eligible for indexing. Until then, only the checked-in catalog can be approved.

## Safe source contract

```json
{
  "id": "captains-quarters-rules",
  "title": "Crew rules",
  "content": "Approved text only",
  "source": "captains-quarters",
  "approved": true,
  "updatedAt": "2026-08-01T00:00:00Z",
  "retentionDays": 90
}
```

No secret, private message, private thread, unapproved channel, or server-setting data belongs in this catalog.
