import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { recoveryScenarioCatalog } from '../src/platform/recovery-scenario-catalog.js';
import {
  normalizeRecoveryMatrix,
  renderRecoveryMatrix,
  requiredRecoveryScenarioGroups,
  validateRecoveryScenarios,
} from '../src/platform/recovery-verification.js';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const committedMatrixPath = fileURLToPath(
  new URL('../docs/PLATFORM_RECOVERY_VERIFICATION.md', import.meta.url),
);
const requiredIssue279ScenarioIds = [
  'platform-version-deployment-identity',
  'platform-configuration-validation',
  'platform-feature-flags',
  'platform-global-pause',
  'platform-operational-audit-records',
  'storage-fresh-migration',
  'storage-legacy-migration',
  'storage-reopen-idempotence',
  'storage-backup-and-restore',
  'storage-restart-recovery',
  'storage-integrity-check',
  'storage-rollback-classification',
  'scheduler-overlap',
  'scheduler-claim-fencing',
  'scheduler-stale-lease-recovery',
  'scheduler-pause-race',
  'scheduler-retry-release',
  'scheduler-draining-shutdown',
  'scheduler-cadence-enforcement',
  'scheduler-suppression-release',
  'provider-unavailable-state',
  'provider-recovered-state',
  'provider-openai-published-state',
  'provider-ollama-published-state',
  'provider-web-search-published-state',
  'provider-rss-published-state',
  'provider-sleeper-published-state',
  'provider-github-published-state',
  'sanitization-operational-logs',
  'sanitization-operational-metrics',
  'sanitization-command-deck',
  'test-environment-runtime-evidence',
] as const;

describe('recovery scenario catalog', () => {
  it('covers every required recovery group and issue #279 acceptance claim', () => {
    validateRecoveryScenarios(recoveryScenarioCatalog, repositoryRoot);

    expect(
      new Set(recoveryScenarioCatalog.map((entry) => entry.group)),
    ).toEqual(new Set(requiredRecoveryScenarioGroups));
    expect(recoveryScenarioCatalog.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([...requiredIssue279ScenarioIds]),
    );
  });

  it('links recovery gaps to focused defects without treating #279 as one', () => {
    // #288 is closed: storage recovery scenarios no longer carry a defect.
    expect(defectFor('storage-reopen-idempotence')).toBeUndefined();
    expect(defectFor('storage-backup-and-restore')).toBeUndefined();
    expect(defectFor('storage-integrity-check')).toBeUndefined();
    expect(defectFor('storage-rollback-classification')).toBeUndefined();
    expect(defectFor('provider-unavailable-state')).toBe('#289');
    expect(defectFor('provider-recovered-state')).toBe('#289');
    expect(defectFor('provider-openai-published-state')).toBe('#289');
    expect(defectFor('provider-ollama-published-state')).toBe('#289');
    expect(defectFor('provider-web-search-published-state')).toBe('#289');
    expect(defectFor('provider-rss-published-state')).toBe('#289');
    expect(defectFor('provider-sleeper-published-state')).toBe('#289');
    expect(defectFor('provider-github-published-state')).toBe('#289');
    expect(defectFor('test-environment-runtime-evidence')).toBeUndefined();
    expect(
      recoveryScenarioCatalog.map((scenario) => scenario.defect),
    ).not.toContain('#279');
    expect(
      recoveryScenarioCatalog
        .filter((scenario) => scenario.group === 'provider')
        .every((scenario) => scenario.defect === '#289'),
    ).toBe(true);
  });

  it('records the executed sanitized receipt as runtime evidence', () => {
    const runtimeEvidence = recoveryScenarioCatalog.find(
      (scenario) => scenario.id === 'test-environment-runtime-evidence',
    );

    expect(runtimeEvidence).toMatchObject({
      claim:
        'The focused verifier writes a sanitized local receipt after executing the exact catalog evidence set.',
      evidence: 'tests/recovery-receipt.test.ts',
    });
    expect(runtimeEvidence?.defect).toBeUndefined();
  });

  it('points every matrix row at committed executable Vitest evidence', () => {
    for (const scenario of recoveryScenarioCatalog) {
      expect(existsSync(`${repositoryRoot}${scenario.evidence}`)).toBe(true);
    }
  });

  it('keeps the committed recovery matrix exactly canonical', () => {
    expect(
      normalizeRecoveryMatrix(readFileSync(committedMatrixPath, 'utf8')),
    ).toBe(
      normalizeRecoveryMatrix(
        renderRecoveryMatrix(recoveryScenarioCatalog, repositoryRoot),
      ),
    );
  });
});

function defectFor(id: string): string | undefined {
  return recoveryScenarioCatalog.find((scenario) => scenario.id === id)?.defect;
}
