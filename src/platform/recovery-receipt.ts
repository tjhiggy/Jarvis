export interface RecoveryReceiptCounts {
  scenarios: number;
  testFiles: number;
  passedTestFiles: number;
  failedTestFiles: number;
}

export interface RecoveryReceipt {
  repositoryVersion: string;
  nodeVersion: string;
  scenarioIds: string[];
  testFiles: string[];
  counts: RecoveryReceiptCounts;
  durationMs: number;
  exitStatus: number;
  redactionPassed: boolean;
}

export function sanitizeRecoveryReceipt(input: unknown): RecoveryReceipt {
  if (!isRecord(input)) {
    throw invalidReceipt();
  }

  const repositoryVersion = input.repositoryVersion;
  const nodeVersion = input.nodeVersion;
  const scenarioIds = input.scenarioIds;
  const testFiles = input.testFiles;
  const counts = input.counts;
  const durationMs = input.durationMs;
  const exitStatus = input.exitStatus;
  const redactionPassed = input.redactionPassed;

  if (
    !isRepositoryVersion(repositoryVersion) ||
    !isNodeVersion(nodeVersion) ||
    !isScenarioIds(scenarioIds) ||
    !isTestFiles(testFiles) ||
    !isCounts(counts) ||
    !isNonNegativeSafeInteger(durationMs) ||
    !isExitStatus(exitStatus) ||
    typeof redactionPassed !== 'boolean' ||
    counts.scenarios !== scenarioIds.length ||
    counts.testFiles !== testFiles.length ||
    counts.passedTestFiles + counts.failedTestFiles !== testFiles.length
  ) {
    throw invalidReceipt();
  }

  return {
    repositoryVersion,
    nodeVersion,
    scenarioIds: [...scenarioIds],
    testFiles: [...testFiles],
    counts: { ...counts },
    durationMs,
    exitStatus,
    redactionPassed,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRepositoryVersion(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)
  );
}

function isNodeVersion(value: unknown): value is string {
  return typeof value === 'string' && /^v\d+\.\d+\.\d+$/.test(value);
}

function isScenarioIds(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (id) =>
        typeof id === 'string' && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id),
    ) &&
    new Set(value).size === value.length
  );
}

function isTestFiles(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (path) =>
        typeof path === 'string' &&
        /^tests(?:\/[A-Za-z0-9._-]+)*\/[A-Za-z0-9._-]+\.test\.ts$/.test(path) &&
        !path.split('/').some((segment) => segment === '.' || segment === '..'),
    ) &&
    new Set(value).size === value.length
  );
}

function isCounts(value: unknown): value is RecoveryReceiptCounts {
  return (
    isRecord(value) &&
    isNonNegativeSafeInteger(value.scenarios) &&
    isNonNegativeSafeInteger(value.testFiles) &&
    isNonNegativeSafeInteger(value.passedTestFiles) &&
    isNonNegativeSafeInteger(value.failedTestFiles)
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isExitStatus(value: unknown): value is number {
  return isNonNegativeSafeInteger(value) && value <= 255;
}

function invalidReceipt(): Error {
  return new Error('Sanitized recovery receipt contains invalid evidence.');
}
