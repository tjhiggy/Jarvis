# Recurring Personal Reminders Design

**Status:** First development slice after v1.6.0
**Scope:** Personal `/reminder` only

## Goal

A member can create, list, and cancel a personal reminder that repeats on a
bounded daily or weekly schedule. The existing SQLite reminder store and
scheduler deliver it. Successful fires must not insert a new one-shot row.

One-shot personal reminders and the shipped administrator shared-reminder
flow stay unchanged. This slice does not add shared-reminder expansion, DM
fallback, export, exact date/time, timezones, or new Discord intents.

## Approach

Reuse the current reminder row. Optional `every` (`daily` | `weekly`) and
`until` (existing 1-minute-to-30-day duration from creation) travel with
create, list, and cancel. After a successful delivery the store advances
`due_at` by the cadence, skipping any slots that are already in the past,
and returns the same row to `pending`. When the next slot would pass
`until`, the row becomes `delivered` like a one-shot.

Permanent failure, uncertain delivery, cancel, retries, leases, owner
mentions, channel revalidation, and the 10-active-reminder cap stay as they
are. A recurring reminder occupies one active slot. Shared-set does not
accept recurrence fields.

## Command

```text
/reminder set in:<duration> message:<text> [every:daily|weekly until:<duration>]
```

`every` and `until` are required together. The first due time must fall on
or before the until bound. List and cancel remain owner-scoped. Command
registration remains operator-owned.

## Schema

Additive reminder migration version 2: nullable `recurrence` and `until_at`
on `reminders`. Existing rows remain one-shot. `PRAGMA user_version` is
unchanged.

## Non-goals

Shared recurrence, DM delivery, export, catch-up spam beyond one late
delivery then the next future slot, and live Discord command registration.
