import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  issue279AcceptanceScenarioIds,
  recoveryScenarioCatalog,
} from '../src/platform/recovery-scenario-catalog.js';
import {
  renderRecoveryMatrix,
  requiredRecoveryScenarioGroups,
  validateRecoveryScenarios,
} from '../src/platform/recovery-verification.js';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const committedMatrixPath = fileURLToPath(
  new URL('../docs/PLATFORM_RECOVERY_VERIFICATION.md', import.meta.url),
);

describe('recovery scenario catalog', () => {
  it('covers every required recovery group and issue #279 acceptance claim', () => {
    validateRecoveryScenarios(recoveryScenarioCatalog, repositoryRoot);

    expect(
      new Set(recoveryScenarioCatalog.map((entry) => entry.group)),
    ).toEqual(new Set(requiredRecoveryScenarioGroups));
    expect(recoveryScenarioCatalog.map((entry) => entry.id)).toEqual(
      expect.arrayContaining([...issue279AcceptanceScenarioIds]),
    );
  });

  it('points every matrix row at committed executable Vitest evidence', () => {
    for (const scenario of recoveryScenarioCatalog) {
      expect(existsSync(`${repositoryRoot}${scenario.evidence}`)).toBe(true);
    }
  });

  it('keeps the committed recovery matrix exactly canonical', () => {
    expect(readFileSync(committedMatrixPath, 'utf8')).toBe(
      renderRecoveryMatrix(recoveryScenarioCatalog, repositoryRoot),
    );
  });
});
