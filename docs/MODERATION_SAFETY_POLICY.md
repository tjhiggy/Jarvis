# MuthaShip moderation safety policy

This document defines the safety boundary for future moderation modules. It is
the contract for AutoMod controls, warnings, moderation logs, and raid
protection. These modules are not enabled merely because this document exists.

## Operating principles

- Discord remains the enforcement authority. Jarvis may request only explicitly
  configured, least-privilege actions.
- Every module is disabled by default, server-scoped, role-allowlisted, and
  independently pauseable.
- Jarvis never grants roles, changes role hierarchy, changes channel
  permissions, bans members, or silently escalates its Discord permissions.
- Public moderation notices contain bounded, plain-language status only. Logs
  never retain message content, tokens, or private evidence by default.
- A human administrator remains responsible for enabling policy and reviewing
  false positives.

## Enablement contract

Before a moderation module can ship, the operator must document and verify:

1. The target MuthaShip, channels, and administrator/moderator role IDs.
2. The exact Discord permissions required by that module.
3. Retention, deletion, opt-out, and audit behavior.
4. A disposable or test-server smoke test with the module enabled.
5. A disabled-state test proving no moderation action occurs when paused.

No module may use a broad Discord Administrator permission as a shortcut.

## Emergency rollback

The Command Deck and Discord fallback must expose a server-scoped emergency
pause. Pause must be durable across restart, suppress new automated actions,
preserve evidence needed for review, and record only actor, server, operation,
timestamp, and safe outcome metadata. Resume requires explicit administrator
action. Deploy rollback is: pause, stop Jarvis, back up SQLite, deploy the prior
known-good release, verify health, and record the result.

## Module boundaries

| Module          | Initial responsibility                                                             | Explicit non-goals                               |
| --------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------ |
| AutoMod         | Configure and report bounded, allowlisted rule state                               | Arbitrary server settings or silent rule changes |
| Warnings        | Record an administrator-issued warning with retention and audit                    | Automated punishment or public shaming           |
| Moderation logs | Content-free action metadata and export-safe audit                                 | Message archives or surveillance                 |
| Raid protection | Detect bounded join/activity spikes and recommend or request a configured response | Autonomous bans, kicks, or role changes          |

The initial raid-protection slice is a pure policy evaluator. It emits a
bounded `flag` or `pause_recommendation`; it does not inspect privileged
member data, change server settings, kick or ban members, or enable lockdown
without a separately authorized integration.

## Release gate

Each module requires implementation tests, migration and rollback rehearsal,
documentation, security review, lint/build/docs checks, a real test-server
smoke test, a disabled/recovery test, release notes, and explicit enablement
evidence before its issue can close.

## AutoMod foundation

Jarvis v1.2 includes a bounded AutoMod policy evaluator. It validates
server-scoped rules for spam, flood, links, and prohibited content, then
returns either `allow` or `flag` for downstream review. This slice does not
delete messages, timeout members, change Discord settings, or make moderation
decisions autonomously. Discord delivery and administrator review remain
explicit integration work, protected by the server pause and rollback rules
above.
