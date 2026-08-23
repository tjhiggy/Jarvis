import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { recoveryScenarioCatalog } from '../src/platform/recovery-scenario-catalog.js';
import {
  sanitizeRecoveryReceipt,
  type RecoveryReceipt,
} from '../src/platform/recovery-receipt.js';
import {
  renderRecoveryMatrix,
  validateRecoveryScenarios,
} from '../src/platform/recovery-verification.js';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const matrixPath = resolve(
  repositoryRoot,
  'docs/PLATFORM_RECOVERY_VERIFICATION.md',
);
const receiptPath = resolve(
  repositoryRoot,
  '.artifacts/qa/platform-recovery.json',
);
const redactionCanary = 'canary-secret-value-do-not-serialize';

await run();

async function run(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  const matrix = validateAndRenderMatrix();

  if (mode === 'write') {
    await writeFile(matrixPath, matrix, 'utf8');
    console.log(
      `Platform recovery matrix written for ${recoveryScenarioCatalog.length} scenarios.`,
    );
    return;
  }

  await validateCommittedMatrix(matrix);

  if (mode === 'check') {
    console.log(
      `Platform recovery check passed for ${recoveryScenarioCatalog.length} scenarios.`,
    );
    return;
  }

  const receipt = await runFocusedVerification();
  await mkdir(resolve(repositoryRoot, '.artifacts/qa'), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');

  if (!receipt.redactionPassed) {
    throw new Error(
      'Platform recovery verification produced unsafe receipt output.',
    );
  }
  if (receipt.exitStatus !== 0) {
    process.exitCode = receipt.exitStatus;
    return;
  }

  console.log(
    `Platform recovery verification passed for ${receipt.counts.scenarios} scenarios and ${receipt.counts.testFiles} focused test files.`,
  );
}

function parseMode(
  arguments_: readonly string[],
): 'check' | 'write' | 'verify' {
  if (arguments_.length === 0) {
    return 'verify';
  }
  if (arguments_.length === 1 && arguments_[0] === '--check') {
    return 'check';
  }
  if (arguments_.length === 1 && arguments_[0] === '--write') {
    return 'write';
  }

  throw new Error(
    'Use only --check or --write with platform recovery verification.',
  );
}

function validateAndRenderMatrix(): string {
  validateRecoveryScenarios(recoveryScenarioCatalog, repositoryRoot);
  return renderRecoveryMatrix(recoveryScenarioCatalog, repositoryRoot);
}

async function validateCommittedMatrix(matrix: string): Promise<void> {
  let committedMatrix: string;
  try {
    committedMatrix = await readFile(matrixPath, 'utf8');
  } catch {
    throw new Error(
      'The platform recovery matrix is missing. Run npm run recovery:write.',
    );
  }

  if (committedMatrix !== matrix) {
    throw new Error(
      'The platform recovery matrix is stale. Run npm run recovery:write and commit the result.',
    );
  }
}

async function runFocusedVerification(): Promise<RecoveryReceipt> {
  const scenarioIds = recoveryScenarioCatalog.map((scenario) => scenario.id);
  const testFiles = [
    ...new Set(recoveryScenarioCatalog.map((scenario) => scenario.evidence)),
  ].sort((left, right) => left.localeCompare(right));
  const startedAt = process.hrtime.bigint();
  const exitStatus = await runVitest(testFiles);
  const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
  const passedTestFiles = exitStatus === 0 ? testFiles.length : 0;

  const receipt = sanitizeRecoveryReceipt({
    repositoryVersion: await readRepositoryVersion(),
    nodeVersion: process.version,
    scenarioIds,
    testFiles,
    counts: {
      scenarios: scenarioIds.length,
      testFiles: testFiles.length,
      passedTestFiles,
      failedTestFiles: testFiles.length - passedTestFiles,
    },
    durationMs,
    exitStatus,
    redactionPassed: true,
  });
  const serializedReceipt = JSON.stringify(receipt);

  if (serializedReceipt.includes(redactionCanary)) {
    throw new Error(
      'Platform recovery verification produced unsafe receipt output.',
    );
  }

  return receipt;
}

async function readRepositoryVersion(): Promise<string> {
  const packageFile = await readFile(
    resolve(repositoryRoot, 'package.json'),
    'utf8',
  );
  const packageManifest: unknown = JSON.parse(packageFile);

  if (
    typeof packageManifest !== 'object' ||
    packageManifest === null ||
    !('version' in packageManifest) ||
    typeof packageManifest.version !== 'string'
  ) {
    throw new Error(
      'Repository version is unavailable for the recovery receipt.',
    );
  }

  return packageManifest.version;
}

function runVitest(testFiles: readonly string[]): Promise<number> {
  const vitestPackagePath = fileURLToPath(
    import.meta.resolve('vitest/package.json'),
  );
  const vitestEntrypoint = resolve(dirname(vitestPackagePath), 'vitest.mjs');

  return new Promise((resolveExitStatus, reject) => {
    const child = spawn(
      process.execPath,
      [vitestEntrypoint, 'run', '--silent=true', ...testFiles],
      {
        cwd: repositoryRoot,
        env: disposableTestEnvironment(),
        stdio: 'ignore',
        windowsHide: true,
      },
    );

    child.once('error', () => {
      reject(
        new Error('Platform recovery verification could not start Vitest.'),
      );
    });
    child.once('exit', (code) => {
      resolveExitStatus(code ?? 1);
    });
  });
}

function disposableTestEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    CI: 'true',
    NODE_ENV: 'test',
    NO_COLOR: '1',
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
  ];

  for (const name of allowedNames) {
    const value = process.env[name];
    if (value !== undefined) {
      environment[name] = value;
    }
  }

  return environment;
}
