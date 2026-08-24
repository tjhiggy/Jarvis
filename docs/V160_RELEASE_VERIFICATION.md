# Jarvis v1.6.0 verification report

This is the #280 closeout ledger for the v1.6 working revision. It separates
executable evidence from operator-owned deployment proof.

## Automated gates

| Gate                 | Command                                                        | Result required before merge                                    |
| -------------------- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| Shipped features     | `npm run features:check`                                       | PASS, inventory matches commands and Command Deck workflows     |
| Platform recovery    | `npm run recovery:check` and `npm run recovery:verify`         | PASS, sanitized receipt                                         |
| Discord journeys     | `npm run journeys:check` and `npm run journeys:verify`         | PASS for synthetic inventory; live rows stay manual             |
| Command Deck API     | `npm run command-deck-api:verify`                              | PASS, sanitized receipt                                         |
| Command Deck cutover | `npm run command-deck-cutover:verify`                          | PASS: local fallback, live identity, rotated token, origin deny |
| Tests and build      | `npm test`, `npm run build`                                    | PASS                                                            |
| Sites                | `npm test --prefix sites/command-deck`, lint, production build | PASS                                                            |
| Docs                 | `npm run docs:check`                                           | PASS                                                            |

## QA slice status

| Issue              | Slice                    | Automated evidence                                           | Remaining operator evidence                                         |
| ------------------ | ------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| #274 / #276 / #275 | Sites 1-3                | Tests, API verifier, mutation suite                          | Private Sites publish                                               |
| #277               | Sites 4/4 cutover        | Cutover verifier, live snapshot presentation, local fallback | Owner-only Sites URL, tunnel, token install, production screenshots |
| #282               | Discord journeys         | Journey matrix and focused tests                             | Live registration, permissions, mobile receipts                     |
| #278               | Command Deck operator QA | Sites tests, cutover verifier, mutation tests                | Desktop/tablet/mobile keyboard pass on the published Sites URL      |
| #280               | Docs and backlog         | This report plus reconciled canonical docs                   | Confirm GitHub milestone after deploy                               |
| #281               | Release                  | Version `1.6.0`, changelog, release notes                    | Tag, GitHub release, ship-computer identity, smoke                  |

## Honest non-claims

- No production Sites URL is committed. The operator publishes it privately.
- No live Discord session was driven by this revision's verification.
- Economy, entertainment adapters, and support-ticket Discord delivery remain
  foundation-only and belong to later milestones.
- `SECURITY.md` now tracks the `1.6.x` support line. Older lines are unsupported.

## Deferred improvements

Assign later, not v1.6 blockers:

- Dedicated `SAFETY_IDENTIFIER_SECRET` independent of provider credentials.
- Stronger backup/restore automation beyond the disposable SQLite rehearsal.
- Root CI lint/format (currently a workstation release gate).
- Dependabot entry for `sites/command-deck`.
- Delete merged remote topic branches after this release.
