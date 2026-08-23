import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { sanitizeRecoveryReceipt } from '../src/platform/recovery-receipt.js';

const executeFile = promisify(execFile);

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
        scenarios: 2,
        testFiles: 2,
        passedTestFiles: 2,
        failedTestFiles: 0,
      },
      durationMs: 1234,
      exitStatus: 0,
      redactionPassed: true,
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
        scenarios: 2,
        testFiles: 2,
        passedTestFiles: 2,
        failedTestFiles: 0,
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
          scenarios: 1,
          testFiles: 1,
          passedTestFiles: 1,
          failedTestFiles: 0,
        },
        durationMs: -1,
        exitStatus: 0,
        redactionPassed: true,
      }),
    ).toThrow(/sanitized recovery receipt/i);
  });

  it('checks the committed recovery matrix without writing it', async () => {
    const result = await executeFile(
      process.execPath,
      ['--import', 'tsx', 'scripts/verify-platform-recovery.ts', '--check'],
      { cwd: process.cwd() },
    );

    expect(result.stdout).toMatch(/platform recovery check passed/i);
  });

  it('writes a content-free receipt for the unique catalog evidence files', async () => {
    const result = await executeFile(
      process.execPath,
      ['--import', 'tsx', 'scripts/verify-platform-recovery.ts'],
      { cwd: process.cwd() },
    );
    const serializedReceipt = await readFile(
      resolve(process.cwd(), '.artifacts/qa/platform-recovery.json'),
      'utf8',
    );
    const receipt = JSON.parse(serializedReceipt) as {
      testFiles: string[];
      redactionPassed: boolean;
    };

    expect(result.stdout).toMatch(/platform recovery verification passed/i);
    expect(receipt.redactionPassed).toBe(true);
    expect(new Set(receipt.testFiles).size).toBe(receipt.testFiles.length);
    expect(serializedReceipt).not.toMatch(
      /canary|authorization|https?:|C:\\\\Users|private member/i,
    );
  });
});
