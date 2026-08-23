import type { RecoveryScenario } from './recovery-verification.js';

export const issue279AcceptanceScenarioIds = [
  'storage-fresh-migration',
  'storage-legacy-migration',
  'storage-restart-recovery',
  'storage-backup-and-restore',
  'storage-rollback-classification',
  'scheduler-overlap',
  'scheduler-claim-fencing',
  'scheduler-stale-lease-recovery',
  'scheduler-pause-race',
  'scheduler-retry-release',
  'scheduler-draining-shutdown',
  'provider-unavailable-state',
  'provider-recovered-state',
  'sanitization-operational-logs',
  'sanitization-operational-metrics',
  'sanitization-command-deck',
  'test-environment-runtime-evidence',
] as const;

export const recoveryScenarioCatalog: readonly RecoveryScenario[] = [
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
    id: 'storage-restart-recovery',
    group: 'storage',
    claim:
      'A creating poll is reconciled after restart without Discord delivery.',
    evidence: 'tests/poll-storage.test.ts',
    recovery:
      'Restart against a disposable database and confirm only durable state reconciliation runs.',
  },
  {
    id: 'storage-backup-and-restore',
    group: 'storage',
    claim:
      'Backup and restore rehearsal is not yet covered by an executable recovery test.',
    evidence: 'tests/storage.test.ts',
    recovery:
      'Do not claim backup or restore readiness until the focused rehearsal defect is resolved.',
    defect: '#279',
  },
  {
    id: 'storage-rollback-classification',
    group: 'storage',
    claim:
      'Explicit rollback classification is not yet covered by an executable recovery test.',
    evidence: 'tests/storage.test.ts',
    recovery:
      'Use the documented stop, backup, and restore procedure until a focused regression is added.',
    defect: '#279',
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
    id: 'provider-unavailable-state',
    group: 'provider',
    claim:
      'An unavailable Ollama server becomes a bounded service error after retries.',
    evidence: 'tests/ollama-service.test.ts',
    recovery:
      'Restore the provider endpoint, then rerun the focused provider health check.',
  },
  {
    id: 'provider-recovered-state',
    group: 'provider',
    claim:
      'Provider recovery transition is not yet covered by an executable recovery test.',
    evidence: 'tests/provider-contract.test.ts',
    recovery:
      'Do not mark the provider recovered until a new safe health snapshot succeeds.',
    defect: '#279',
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
      'The sanitized focused runtime receipt is pending the dedicated verifier slice.',
    evidence: 'tests/recovery-verification.test.ts',
    recovery:
      'Do not attach runtime evidence until the focused verifier writes a sanitized receipt.',
    defect: '#279',
  },
];
