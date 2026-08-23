import type { RecoveryReceiptCounts } from './recovery-receipt.js';

export interface RecoveryEvidenceScenario {
  id: string;
  evidence: string;
  defect?: string;
}

export interface FocusedRecoveryEvidenceResult {
  testFiles: string[];
  counts: RecoveryReceiptCounts;
  exitStatus: number;
}

export type FocusedVitestRunner = (testFile: string) => Promise<number>;

export function createDisposableTestEnvironment(
  processEnvironment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    CI: 'true',
    NODE_ENV: 'test',
    NO_COLOR: '1',
    PLATFORM_RECOVERY_FOCUSED_RUNNER: 'true',
  };
  const allowedNames = [
    'ComSpec',
    'COMSPEC',
    'Path',
    'PATH',
    'PATHEXT',
    'SystemRoot',
    'SYSTEMROOT',
    'TEMP',
    'TMP',
    'TMPDIR',
  ];

  for (const name of allowedNames) {
    const value = processEnvironment[name];
    if (value !== undefined) {
      environment[name] = value;
    }
  }

  return environment;
}

export async function runFocusedRecoveryEvidence(
  scenarios: readonly RecoveryEvidenceScenario[],
  runVitest: FocusedVitestRunner,
): Promise<FocusedRecoveryEvidenceResult> {
  const testFiles = [
    ...new Set(scenarios.map((scenario) => scenario.evidence)),
  ].sort((left, right) => left.localeCompare(right));
  let passedFiles = 0;
  let failedFiles = 0;
  let exitStatus = 0;

  for (const testFile of testFiles) {
    const testExitStatus = await runVitest(testFile);
    if (testExitStatus === 0) {
      passedFiles += 1;
    } else {
      failedFiles += 1;
      exitStatus ||= testExitStatus;
    }
  }

  return {
    testFiles,
    counts: {
      totalScenarios: scenarios.length,
      verifiedScenarios: scenarios.filter(
        (scenario) => scenario.defect === undefined,
      ).length,
      defectLinkedScenarios: scenarios.filter(
        (scenario) => scenario.defect !== undefined,
      ).length,
      totalFiles: testFiles.length,
      passedFiles,
      failedFiles,
    },
    exitStatus,
  };
}

export function classifyRecoveryMatrixReadError(error: unknown): Error {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  ) {
    return new Error(
      'The platform recovery matrix is missing. Run npm run recovery:write.',
    );
  }

  return new Error('The platform recovery matrix could not be read.');
}
