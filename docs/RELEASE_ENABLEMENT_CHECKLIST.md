# Jarvis release enablement checklist

Every feature release must carry this evidence before its issue or milestone
closes. Do not rely on a remembered Discord setting or an unrecorded desktop
change.

## Configuration

- [ ] `.env.example` and the release docs identify every required setting.
- [ ] Secrets are stored outside source control and are never printed.
- [ ] Feature flags, destination channels, administrator roles, and providers
      are recorded for the target MuthaShip.

## Verification

- [ ] Jarvis restarted and commands re-registered after configuration changes.
- [ ] Required Discord permissions, channels, and roles verified in a test
      channel or disposable server.
- [ ] Happy path, disabled path, retry path, and recovery path exercised.
- [ ] Smoke-test transcript or screenshots attached to the issue or release.

## Release safety

- [ ] Full tests, build, lint, format, and docs checks pass.
- [ ] Deployment identity, database backup, migration result, and rollback
      target recorded.
- [ ] Command Deck readiness is healthy and no secret values are exposed.
- [ ] Issue closure comment links the evidence and names any deferred setup.
