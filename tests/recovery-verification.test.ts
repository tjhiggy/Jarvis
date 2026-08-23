import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  renderRecoveryMatrix,
  validateRecoveryScenarios,
  type RecoveryScenario,
} from '../src/platform/recovery-verification.js';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

const validScenarios: RecoveryScenario[] = [
  scenario('storage-migration', 'storage'),
  scenario('scheduler-lease', 'scheduler'),
  scenario('provider-recovery', 'provider'),
  scenario('sanitization-logs', 'sanitization'),
];

describe('recovery scenario validation', () => {
  it('rejects duplicate scenario IDs that would collapse matrix evidence', () => {
    const scenarios = [
      ...validScenarios,
      scenario('storage-migration', 'storage'),
    ];

    expect(() => validateRecoveryScenarios(scenarios, repositoryRoot)).toThrow(
      /duplicate scenario id/i,
    );
  });

  it('rejects a catalog that omits a required recovery group', () => {
    const scenarios = validScenarios.filter(
      (entry) => entry.group !== 'provider',
    );

    expect(() => validateRecoveryScenarios(scenarios, repositoryRoot)).toThrow(
      /missing required recovery group.*provider/i,
    );
  });

  it.each([
    [
      'missing evidence',
      'tests/not-present.test.ts',
      /evidence file does not exist/i,
    ],
    [
      'absolute evidence',
      'C:\\private\\evidence.test.ts',
      /safe repository-relative/i,
    ],
    [
      'parent traversal',
      '../tests/storage.test.ts',
      /safe repository-relative/i,
    ],
    [
      'normalized parent traversal',
      'tests/../tests/storage.test.ts',
      /safe repository-relative/i,
    ],
    [
      'non-test evidence',
      'src/platform/contracts.ts',
      /tests\/\*\*\/\*.test.ts/i,
    ],
  ])('rejects %s paths', (_label, evidence, message) => {
    const scenarios = validScenarios.map((entry, index) =>
      index === 0 ? { ...entry, evidence } : entry,
    );

    expect(() => validateRecoveryScenarios(scenarios, repositoryRoot)).toThrow(
      message,
    );
  });

  it('rejects empty operator recovery guidance', () => {
    const scenarios = validScenarios.map((entry, index) =>
      index === 0 ? { ...entry, recovery: '  ' } : entry,
    );

    expect(() => validateRecoveryScenarios(scenarios, repositoryRoot)).toThrow(
      /recovery guidance/i,
    );
  });

  it.each([
    ['blank', ''],
    ['unprefixed', '288'],
    ['zero', '#0'],
    ['non-numeric', '#not-a-number'],
  ])('rejects a %s defect reference', (_label, defect) => {
    const scenarios = validScenarios.map((entry, index) =>
      index === 0 ? { ...entry, defect } : entry,
    );

    expect(() => validateRecoveryScenarios(scenarios, repositoryRoot)).toThrow(
      /defect reference/i,
    );
  });

  it('rejects symlinked evidence even when its path looks repository-contained', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'jarvis-recovery-'));
    const testsDirectory = join(fixtureRoot, 'tests');
    const externalEvidence = join(tmpdir(), 'jarvis-recovery-external.test.ts');
    const symlinkEvidence = join(testsDirectory, 'escape.test.ts');

    try {
      await mkdir(testsDirectory, { recursive: true });
      await writeFile(externalEvidence, 'export {};\n');
      await symlink(externalEvidence, symlinkEvidence, 'file');
    } catch (error: unknown) {
      if (
        process.platform === 'win32' &&
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error.code === 'EPERM' || error.code === 'EACCES')
      ) {
        await rm(fixtureRoot, { force: true, recursive: true });
        await rm(externalEvidence, { force: true });
        return;
      }
      throw error;
    }

    try {
      expect(() =>
        validateRecoveryScenarios(
          fixtureScenarios('tests/escape.test.ts'),
          fixtureRoot,
        ),
      ).toThrow(/symbolic link|resolved evidence/i);
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
      await rm(externalEvidence, { force: true });
    }
  });

  it('rejects evidence whose real path resolves outside its repository fixture', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'jarvis-recovery-'));
    const testsDirectory = join(fixtureRoot, 'tests');
    const fixtureEvidence = join(testsDirectory, 'evidence.test.ts');
    const externalEvidence = join(tmpdir(), 'jarvis-recovery-realpath.test.ts');

    try {
      await mkdir(testsDirectory, { recursive: true });
      await writeFile(fixtureEvidence, 'export {};\n');
      await writeFile(externalEvidence, 'export {};\n');

      expect(() =>
        validateRecoveryScenarios(
          fixtureScenarios('tests/evidence.test.ts'),
          fixtureRoot,
          {
            realpath: (path) =>
              path === resolve(fixtureEvidence) ? externalEvidence : path,
          },
        ),
      ).toThrow(/resolved evidence/i);
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
      await rm(externalEvidence, { force: true });
    }
  });

  it.each(['canary-secret-value', 'private-data-payload'])(
    'rejects unsafe %s in operator-facing catalog text',
    (unsafeText) => {
      const scenarios = validScenarios.map((entry, index) =>
        index === 0 ? { ...entry, claim: unsafeText } : entry,
      );

      expect(() =>
        validateRecoveryScenarios(scenarios, repositoryRoot),
      ).toThrow(/unsafe private-data or canary string/i);
    },
  );

  it('renders the same deterministic Markdown matrix for the same valid catalog', () => {
    const first = renderRecoveryMatrix(validScenarios, repositoryRoot);
    const second = renderRecoveryMatrix(validScenarios, repositoryRoot);

    expect(first).toBe(second);
    expect(first).toContain('# Platform Recovery Verification Matrix');
    expect(first).toMatch(
      /\| ID\s+\| Group\s+\| Claim\s+\| Evidence\s+\| Recovery\s+\| Defect\s+\|/,
    );
    expect(first).toContain('`tests/storage.test.ts`');
  });
});

function scenario(
  id: string,
  group: RecoveryScenario['group'],
): RecoveryScenario {
  return {
    id,
    group,
    claim: `${group} recovery claim`,
    evidence: 'tests/storage.test.ts',
    recovery: 'Run the focused test against disposable synthetic state.',
  };
}

function fixtureScenarios(evidence: string): RecoveryScenario[] {
  return [
    scenarioWithEvidence('storage-fixture', 'storage', evidence),
    scenarioWithEvidence('scheduler-fixture', 'scheduler', evidence),
    scenarioWithEvidence('provider-fixture', 'provider', evidence),
    scenarioWithEvidence('sanitization-fixture', 'sanitization', evidence),
  ];
}

function scenarioWithEvidence(
  id: string,
  group: RecoveryScenario['group'],
  evidence: string,
): RecoveryScenario {
  return { ...scenario(id, group), evidence };
}
