import type { RecoveryScenario } from './recovery-verification.js';

export const recoveryScenarioCatalog: readonly RecoveryScenario[] = [
  {
    id: 'platform-version-deployment-identity',
    group: 'platform',
    claim:
      'Version and deployment identity use trusted build metadata without exposing host details.',
    evidence: 'tests/runtime-question.test.ts',
    recovery:
      'Confirm the reported version and build identity from trusted metadata before making a rollout decision.',
  },
  {
    id: 'platform-configuration-validation',
    group: 'platform',
    claim:
      'Invalid required configuration is rejected without exposing supplied secrets.',
    evidence: 'tests/config.test.ts',
    recovery:
      'Correct the named configuration category and restart with approved values only.',
  },
  {
    id: 'platform-feature-flags',
    group: 'platform',
    claim:
      'Feature flags preserve safe defaults and reject unsupported overrides.',
    evidence: 'tests/feature-flags.test.ts',
    recovery:
      'Inspect the durable feature state and restore the approved override before resuming work.',
  },
  {
    id: 'platform-global-pause',
    group: 'platform',
    claim: 'A persisted global pause blocks broadcast delivery before posting.',
    evidence: 'tests/broadcast-policy.test.ts',
    recovery:
      'Keep the global pause active until policy and destination checks are ready to resume.',
  },
  {
    id: 'platform-operational-audit-records',
    group: 'platform',
    claim:
      'Operational audit records accept bounded metadata and redact content.',
    evidence: 'tests/moderation-audit.test.ts',
    recovery:
      'Review only bounded audit metadata while investigating an operational event.',
  },
  {
    id: 'storage-fresh-migration',
    group: 'storage',
    claim:
      'Fresh SQLite migration creates the required schema in disposable test state.',
    evidence: 'tests/engagement-storage.test.ts',
    recovery:
      'Run the focused storage test against its temporary database before rollout.',
  },
  {
    id: 'storage-legacy-migration',
    group: 'storage',
    claim:
      'Legacy active introductions migrate without discarding the recoverable newer record.',
    evidence: 'tests/engagement-storage.test.ts',
    recovery:
      'Stop the runtime, back up the database, then reproduce the migration on a disposable copy.',
  },
  {
    id: 'storage-reopen-idempotence',
    group: 'storage',
    claim:
      'Shared-database reopen after all schema owners migrate is idempotent and remains integrity-clean.',
    evidence: 'tests/storage-recovery.test.ts',
    recovery:
      'Stop the runtime, reopen against a disposable copy of the shared database, and confirm every store health check still passes.',
  },
  {
    id: 'storage-restart-recovery',
    group: 'storage',
    claim:
      'A creating poll is reconciled after restart without Discord delivery.',
    evidence: 'tests/poll-storage.test.ts',
    recovery:
      'Restart against a disposable database and confirm only durable state reconciliation runs.',
  },
  {
    id: 'storage-integrity-check',
    group: 'storage',
    claim:
      'SQLite integrity-check passes on a shared database after all schema owners migrate and write synthetic sentinels.',
    evidence: 'tests/storage-recovery.test.ts',
    recovery:
      'Run PRAGMA integrity_check against a stopped disposable database before accepting a backup.',
  },
  {
    id: 'storage-backup-and-restore',
    group: 'storage',
    claim:
      'WAL-safe backup of the shared database restores conversation, engagement, poll, reminder, broadcast, and RSS sentinels.',
    evidence: 'tests/storage-recovery.test.ts',
    recovery:
      'Stop Jarvis, checkpoint WAL, copy the database, restore to a new path, and verify sentinel rows plus integrity.',
  },
  {
    id: 'storage-rollback-classification',
    group: 'storage',
    claim:
      'A database with a newer user_version is refused and classified as requiring a pre-upgrade backup restore.',
    evidence: 'tests/storage-recovery.test.ts',
    recovery:
      'Do not open a newer schema with an older binary. Restore a pre-upgrade backup taken with a matching application version.',
  },
  {
    id: 'scheduler-overlap',
    group: 'scheduler',
    claim: 'Overlapping reminder ticks share one active run.',
    evidence: 'tests/reminder-scheduler.test.ts',
    recovery:
      'Wait for the active tick to finish before starting a replacement scheduler.',
  },
  {
    id: 'scheduler-claim-fencing',
    group: 'scheduler',
    claim:
      'Stale broadcast workers cannot complete delivery with an obsolete lease token.',
    evidence: 'tests/broadcast-storage.test.ts',
    recovery:
      'Allow the active lease owner to finish or expire before retrying delivery.',
  },
  {
    id: 'scheduler-stale-lease-recovery',
    group: 'scheduler',
    claim:
      'Expired reminder claims recover while uncertain delivery is never automatically reclaimed.',
    evidence: 'tests/reminder-storage.test.ts',
    recovery:
      'Recover only expired safe claims and investigate uncertain delivery before retrying.',
  },
  {
    id: 'scheduler-pause-race',
    group: 'scheduler',
    claim: 'A recap pause race releases its lease without posting.',
    evidence: 'tests/recap-scheduler.test.ts',
    recovery:
      'Keep the feature paused and resume only after confirming the lease was released.',
  },
  {
    id: 'scheduler-retry-release',
    group: 'scheduler',
    claim:
      'Transient reminder failures receive bounded retries and exhausted work fails safely.',
    evidence: 'tests/reminder-scheduler.test.ts',
    recovery:
      'Let bounded retry scheduling run; investigate exhausted items before manual action.',
  },
  {
    id: 'scheduler-recurring-personal-reminder',
    group: 'scheduler',
    claim:
      'A delivered personal recurring reminder advances the same row to the next bounded due time without inserting another reminder.',
    evidence: 'tests/reminder-scheduler.test.ts',
    recovery:
      'Leave the live row in place. Do not insert replacement one-shot rows after a fire.',
  },
  {
    id: 'scheduler-draining-shutdown',
    group: 'scheduler',
    claim: 'Shutdown drains an in-flight RSS tick before storage closes.',
    evidence: 'tests/application.test.ts',
    recovery:
      'Request shutdown once and wait for the active tick to drain before restart.',
  },
  {
    id: 'scheduler-cadence-enforcement',
    group: 'scheduler',
    claim:
      'Broadcast policy blocks delivery until the configured minimum cadence has elapsed.',
    evidence: 'tests/broadcast-policy.test.ts',
    recovery:
      'Wait for the configured cadence window instead of forcing a duplicate delivery.',
  },
  {
    id: 'scheduler-suppression-release',
    group: 'scheduler',
    claim:
      'Policy-suppressed event reminders release their claim so they remain retryable.',
    evidence: 'tests/broadcast-adopters.test.ts',
    recovery:
      'Keep delivery suppressed until policy resumes; the released claim can then retry safely.',
  },
  {
    id: 'provider-unavailable-state',
    group: 'provider',
    claim:
      'Published provider health snapshots report unavailable when runtime probes fail.',
    evidence: 'tests/provider-recovery.test.ts',
    recovery:
      'Restore the provider endpoint, then confirm a new safe health snapshot reports ready.',
  },
  {
    id: 'provider-recovered-state',
    group: 'provider',
    claim:
      'Published provider health snapshots transition unavailable to ready after a successful probe.',
    evidence: 'tests/provider-recovery.test.ts',
    recovery:
      'Do not mark the provider recovered until a new safe health snapshot succeeds.',
  },
  {
    id: 'provider-openai-published-state',
    group: 'provider',
    claim:
      'OpenAI published availability follows the safe runtime health snapshot, not configuration presence alone.',
    evidence: 'tests/provider-recovery.test.ts',
    recovery:
      'Do not publish OpenAI recovery until a new safe health snapshot succeeds.',
  },
  {
    id: 'provider-ollama-published-state',
    group: 'provider',
    claim:
      'Ollama published availability follows the safe runtime health snapshot, not configuration presence alone.',
    evidence: 'tests/provider-recovery.test.ts',
    recovery:
      'Do not publish Ollama recovery until a new safe health snapshot succeeds.',
  },
  {
    id: 'provider-web-search-published-state',
    group: 'provider',
    claim:
      'Web-search published availability follows the safe runtime health snapshot, not configuration presence alone.',
    evidence: 'tests/provider-recovery.test.ts',
    recovery:
      'Do not publish web-search recovery until a new safe health snapshot succeeds.',
  },
  {
    id: 'provider-rss-published-state',
    group: 'provider',
    claim:
      'RSS published availability follows configured-and-runtime-available health state.',
    evidence: 'tests/provider-recovery.test.ts',
    recovery:
      'Do not publish RSS recovery until a new safe health snapshot succeeds.',
  },
  {
    id: 'provider-sleeper-published-state',
    group: 'provider',
    claim:
      'Sleeper published availability follows the safe runtime health snapshot, not configuration presence alone.',
    evidence: 'tests/provider-recovery.test.ts',
    recovery:
      'Do not publish Sleeper recovery until a new safe health snapshot succeeds.',
  },
  {
    id: 'provider-github-published-state',
    group: 'provider',
    claim:
      'GitHub published availability follows the safe runtime health snapshot, not configuration presence alone.',
    evidence: 'tests/provider-recovery.test.ts',
    recovery:
      'Do not publish GitHub recovery until a new safe health snapshot succeeds.',
  },
  {
    id: 'sanitization-operational-logs',
    group: 'sanitization',
    claim: 'Operational logs redact secret fields and omit error content.',
    evidence: 'tests/logger.test.ts',
    recovery:
      'Preserve only sanitized categories and metadata while investigating the failure.',
  },
  {
    id: 'sanitization-operational-metrics',
    group: 'sanitization',
    claim: 'Platform metrics store bounded content-free delivery aggregates.',
    evidence: 'tests/platform-metrics.test.ts',
    recovery:
      'Inspect aggregate metrics only; do not collect message or provider payload content.',
  },
  {
    id: 'command-deck-local-fallback',
    group: 'platform',
    claim:
      'The localhost Command Deck remains available when the Sites surface is stale or offline.',
    evidence: 'tests/command-deck-cutover.test.ts',
    recovery:
      'Stop using the Sites URL and operate from http://127.0.0.1:8787 or Discord fallback commands.',
  },
  {
    id: 'command-deck-token-rotation',
    group: 'platform',
    claim:
      'A rotated Command Deck read token is rejected until Jarvis restarts with the new secret.',
    evidence: 'tests/command-deck-cutover.test.ts',
    recovery:
      'Update the Sites read secret and Jarvis COMMAND_DECK_API_TOKEN together, restart Jarvis, then confirm a fresh snapshot succeeds.',
  },
  {
    id: 'command-deck-origin-allowlist',
    group: 'platform',
    claim:
      'Remote Command Deck reads from an unlisted origin are denied without leaking secrets.',
    evidence: 'tests/command-deck-cutover.test.ts',
    recovery:
      'Set COMMAND_DECK_API_ALLOWED_ORIGINS to the exact private Sites page origin and retry.',
  },
  {
    id: 'sanitization-command-deck',
    group: 'sanitization',
    claim:
      'The Command Deck serves a secret-free local dashboard and JSON snapshot.',
    evidence: 'tests/admin-console.test.ts',
    recovery:
      'Use the local dashboard for state only and keep credentials outside its responses.',
  },
  {
    id: 'test-environment-runtime-evidence',
    group: 'sanitization',
    claim:
      'The focused verifier writes a sanitized local receipt after executing the exact catalog evidence set.',
    evidence: 'tests/recovery-receipt.test.ts',
    recovery:
      'Run the focused verifier and inspect only its aggregate receipt and redaction result.',
  },
];
