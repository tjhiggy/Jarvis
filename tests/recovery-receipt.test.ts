import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  classifyRecoveryMatrixReadError,
  runFocusedRecoveryEvidence,
} from '../src/platform/recovery-focused-runner.js';
import * as recoveryFocusedRunner from '../src/platform/recovery-focused-runner.js';
import { sanitizeRecoveryReceipt } from '../src/platform/recovery-receipt.js';

const executeFile = promisify(execFile);
const isFocusedRecoveryRun =
  process.env.PLATFORM_RECOVERY_FOCUSED_RUNNER === 'true';

describe('recovery receipt sanitization', () => {
  it('keeps only allowlisted aggregate evidence when given unsafe diagnostic data', () => {
    const canary = 'canary-secret-value-do-not-serialize';
    const receipt = sanitizeRecoveryReceipt({
      repositoryVersion: '1.5.0',
      nodeVersion: 'v22.16.0',
      scenarioIds: ['storage-fresh-migration', 'scheduler-overlap'],
      testFiles: [
        'tests/engagement-storage.test.ts',
        'tests/reminder-scheduler.test.ts',
      ],
      counts: {
        totalScenarios: 2,
        verifiedScenarios: 1,
        defectLinkedScenarios: 1,
        totalFiles: 2,
        passedFiles: 2,
        failedFiles: 0,
        nestedCanary: canary,
      },
      durationMs: 1234,
      exitStatus: 0,
      redactionPassed: false,
      canary,
      discordUserId: '123456789012345678',
      providerUrl: 'https://operator:password@example.test/v1',
      authorization: `Bearer ${canary}`,
      prompt: 'Summarize private member content.',
      error: `first line\nsecond line: ${canary}`,
      failure: {
        headers: { authorization: `Bearer ${canary}` },
        nested: { databasePath: 'C:\\Users\\Jim\\private.sqlite' },
      },
      diagnosticMetadata: {
        nestedCanary: canary,
      },
    });

    expect(receipt).toEqual({
      repositoryVersion: '1.5.0',
      nodeVersion: 'v22.16.0',
      scenarioIds: ['storage-fresh-migration', 'scheduler-overlap'],
      testFiles: [
        'tests/engagement-storage.test.ts',
        'tests/reminder-scheduler.test.ts',
      ],
      counts: {
        totalScenarios: 2,
        verifiedScenarios: 1,
        defectLinkedScenarios: 1,
        totalFiles: 2,
        passedFiles: 2,
        failedFiles: 0,
      },
      durationMs: 1234,
      exitStatus: 0,
      redactionPassed: true,
    });
    expect(JSON.stringify(receipt)).not.toContain(canary);
    expect(JSON.stringify(receipt)).not.toMatch(
      /123456789012345678|example\.test|authorization|private member|private\.sqlite/i,
    );
  });

  it('rejects values that cannot be represented as bounded repository evidence', () => {
    expect(() =>
      sanitizeRecoveryReceipt({
        repositoryVersion: '1.5.0',
        nodeVersion: 'v22.16.0',
        scenarioIds: ['123456789012345678'],
        testFiles: ['C:\\private\\evidence.test.ts'],
        counts: {
          totalScenarios: 1,
          verifiedScenarios: 1,
          defectLinkedScenarios: 0,
          totalFiles: 1,
          passedFiles: 1,
          failedFiles: 0,
        },
        durationMs: -1,
        exitStatus: 0,
        redactionPassed: true,
      }),
    ).toThrow(/sanitized recovery receipt/i);
  });

  it('does not attest redaction when the raw receipt omits the fixed canary', () => {
    const receipt = sanitizeRecoveryReceipt({
      repositoryVersion: '1.5.0',
      nodeVersion: 'v22.16.0',
      scenarioIds: ['storage-fresh-migration'],
      testFiles: ['tests/engagement-storage.test.ts'],
      counts: {
        totalScenarios: 1,
        verifiedScenarios: 1,
        defectLinkedScenarios: 0,
        totalFiles: 1,
        passedFiles: 1,
        failedFiles: 0,
      },
      durationMs: 1234,
      exitStatus: 0,
      redactionPassed: true,
    });

    expect(receipt.redactionPassed).toBe(false);
  });

  it('aggregates one passing and one failing unique evidence file independently', async () => {
    const runVitest = async (testFile: string) =>
      testFile === 'tests/failing-evidence.test.ts' ? 1 : 0;

    const result = await runFocusedRecoveryEvidence(
      [
        {
          id: 'storage-fresh-migration',
          evidence: 'tests/passing-evidence.test.ts',
        },
        {
          id: 'scheduler-overlap',
          evidence: 'tests/passing-evidence.test.ts',
        },
        {
          id: 'provider-unavailable-state',
          evidence: 'tests/failing-evidence.test.ts',
          defect: '#289',
        },
      ],
      runVitest,
    );

    expect(result.counts).toEqual({
      totalScenarios: 3,
      verifiedScenarios: 2,
      defectLinkedScenarios: 1,
      totalFiles: 2,
      passedFiles: 1,
      failedFiles: 1,
    });
    expect(result.exitStatus).toBe(1);
    expect(result.testFiles).toEqual([
      'tests/failing-evidence.test.ts',
      'tests/passing-evidence.test.ts',
    ]);
  });

  it('preserves TMPDIR in the restricted focused-test environment', () => {
    const environmentCreator = (
      recoveryFocusedRunner as Record<string, unknown>
    ).createDisposableTestEnvironment;

    expect(environmentCreator).toBeTypeOf('function');
    if (typeof environmentCreator !== 'function') {
      return;
    }

    const environment = (
      environmentCreator as (input: NodeJS.ProcessEnv) => NodeJS.ProcessEnv
    )({ TMPDIR: 'C:\\synthetic-temp-directory' });

    expect(environment.TMPDIR).toBe('C:\\synthetic-temp-directory');
  });

  it('distinguishes a missing recovery matrix from a sanitized read failure', () => {
    expect(classifyRecoveryMatrixReadError({ code: 'ENOENT' }).message).toMatch(
      /matrix is missing/i,
    );
    expect(
      classifyRecoveryMatrixReadError(
        new Error('C:\\Users\\Jim\\private\\canary-secret-value'),
      ).message,
    ).toBe('The platform recovery matrix could not be read.');
  });

  it('checks the committed recovery matrix without writing it', async () => {
    const result = await executeFile(
      process.execPath,
      ['--import', 'tsx', 'scripts/verify-platform-recovery.ts', '--check'],
      { cwd: process.cwd() },
    );

    expect(result.stdout).toMatch(/platform recovery check passed/i);
  });

  it.skipIf(isFocusedRecoveryRun)(
    'writes a content-free receipt for the unique catalog evidence files',
    async () => {
      const focusedTmpdir = await mkdtemp(
        resolve(tmpdir(), 'jarvis-recovery-focused-'),
      );
      try {
        const result = await executeFile(
          process.execPath,
          ['--import', 'tsx', 'scripts/verify-platform-recovery.ts'],
          {
            cwd: process.cwd(),
            env: { ...process.env, TMPDIR: focusedTmpdir },
          },
        );
        const serializedReceipt = await readFile(
          resolve(process.cwd(), '.artifacts/qa/platform-recovery.json'),
          'utf8',
        );
        const receipt = JSON.parse(serializedReceipt) as {
          testFiles: string[];
          redactionPassed: boolean;
        };

        expect(result.stdout).toMatch(
          /platform recovery verification completed/i,
        );
        expect(receipt.redactionPassed).toBe(true);
        expect(new Set(receipt.testFiles).size).toBe(receipt.testFiles.length);
        expect(serializedReceipt).not.toMatch(
          /canary|authorization|https?:|C:\\\\Users|private member/i,
        );
      } finally {
        await rm(focusedTmpdir, { force: true, recursive: true });
      }
    },
    60_000,
  );
});
