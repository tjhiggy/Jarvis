# Jarvis Discussions

GitHub Discussions are the friendly intake path for MuthaShip administrators.
Use them to explore ideas, ask questions, and compare possible approaches
before anyone commits development time.

## The simple rule

**Discussion = explore the idea**

**Issue = approved work**

**Project Board = planned work**

**Pull request = implementation**

## Categories

- **Ideas & Feedback**: feature ideas and improvements.
- **Questions & Help**: how Jarvis works or how to use it.
- **Admin Operations**: configuration, permissions, deployment, and support.
- **Announcements**: maintainer-owned updates.

The first three categories have friendly forms in
`.github/DISCUSSION_TEMPLATE/`. They are intentionally written for people who
do not work in software development.

## Triage lifecycle

1. A discussion is created and receives `discussion:new`.
2. The native Discussion workflow adds a triage note and
   `discussion:triaged`.
3. Administrators discuss the idea and request more information when needed.
4. Apply `discussion:accepted` only when the idea is ready to become tracked
   work.
5. GitHub creates an Issue containing the proposal and source Discussion link.
6. The Issue receives `backlog`, `source:discussion`, and a category label.
7. Project automation adds it to the Delivery Board and applies normal issue
   lifecycle rules.

Use `discussion:needs-info`, `discussion:declined`, or `discussion:duplicate`
when an Issue should not be created. Do not use `discussion:accepted` as a
vote or a promise of delivery. It means only that the proposal is ready for
formal backlog triage.

## What to include

- the problem or opportunity;
- the desired outcome;
- an example of how a member or administrator would use it;
- screenshots or evidence with secrets and private data removed.

Do not post passwords, API keys, private member information, raw production
logs, or security vulnerability details. Use the security reporting route for
security concerns.

## Automation boundary

The workflow is intentionally deterministic. It organizes and converts an
approved discussion, but it does not make product decisions, assign a sprint,
create a release, mark work Released, or change Discord server settings.

GitHub Discussion events are currently a public-preview Actions feature. Keep
the maintainer approval label even if GitHub changes that event behavior.
