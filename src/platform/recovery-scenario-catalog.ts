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
      'Broadcast-store reopen preserves durable policy, but all-schema shared-database reopen remains unverified.',
    evidence: 'tests/broadcast-storage.test.ts',
    recovery:
      'Do not claim shared-database reopen readiness until the focused rehearsal defect is resolved.',
    defect: '#288',
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
      'SQLite integrity-check rehearsal is not yet covered by an executable recovery test.',
    evidence: 'tests/storage.test.ts',
    recovery:
      'Do not claim storage integrity readiness until the focused rehearsal defect is resolved.',
    defect: '#288',
  },
  {
    id: 'storage-backup-and-restore',
    group: 'storage',
    claim:
      'Backup and restore rehearsal is not yet covered by an executable recovery test.',
    evidence: 'tests/storage.test.ts',
    recovery:
      'Do not claim backup or restore readiness until the focused rehearsal defect is resolved.',
    defect: '#288',
  },
  {
    id: 'storage-rollback-classification',
    group: 'storage',
    claim:
      'Explicit rollback classification is not yet covered by an executable recovery test.',
    evidence: 'tests/storage.test.ts',
    recovery:
      'Use the documented stop, backup, and restore procedure until a focused regression is added.',
    defect: '#288',
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
      'An unavailable Ollama server becomes a bounded service error after retries.',
    evidence: 'tests/ollama-service.test.ts',
    recovery:
      'Restore the provider endpoint, then rerun the focused provider health check.',
    defect: '#289',
  },
  {
    id: 'provider-recovered-state',
    group: 'provider',
    claim:
      'Provider recovery transition is not yet covered by an executable recovery test.',
    evidence: 'tests/provider-contract.test.ts',
    recovery:
      'Do not mark the provider recovered until a new safe health snapshot succeeds.',
    defect: '#289',
  },
  {
    id: 'provider-openai-published-state',
    group: 'provider',
    claim:
      'OpenAI service failures and retries are executable, but published unavailable-to-recovered state is not.',
    evidence: 'tests/openai-service.test.ts',
    recovery:
      'Do not publish OpenAI recovery until a new safe health snapshot succeeds.',
    defect: '#289',
  },
  {
    id: 'provider-ollama-published-state',
    group: 'provider',
    claim:
      'Ollama service failures are executable, but published unavailable-to-recovered state is not.',
    evidence: 'tests/ollama-service.test.ts',
    recovery:
      'Do not publish Ollama recovery until a new safe health snapshot succeeds.',
    defect: '#289',
  },
  {
    id: 'provider-web-search-published-state',
    group: 'provider',
    claim:
      'Web-search behavior is executable, but published unavailable-to-recovered state is not.',
    evidence: 'tests/web-search.test.ts',
    recovery:
      'Do not publish web-search recovery until a new safe health snapshot succeeds.',
    defect: '#289',
  },
  {
    id: 'provider-rss-published-state',
    group: 'provider',
    claim:
      'RSS client behavior is executable, but published unavailable-to-recovered state is not.',
    evidence: 'tests/rss-notifications.test.ts',
    recovery:
      'Do not publish RSS recovery until a new safe health snapshot succeeds.',
    defect: '#289',
  },
  {
    id: 'provider-sleeper-published-state',
    group: 'provider',
    claim:
      'Sleeper service failures are executable, but published unavailable-to-recovered state is not.',
    evidence: 'tests/sleeper/sleeper-service.test.ts',
    recovery:
      'Do not publish Sleeper recovery until a new safe health snapshot succeeds.',
    defect: '#289',
  },
  {
    id: 'provider-github-published-state',
    group: 'provider',
    claim:
      'GitHub service failures are executable, but published unavailable-to-recovered state is not.',
    evidence: 'tests/github-service.test.ts',
    recovery:
      'Do not publish GitHub recovery until a new safe health snapshot succeeds.',
    defect: '#289',
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
