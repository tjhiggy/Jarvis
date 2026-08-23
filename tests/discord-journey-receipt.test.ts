import { describe, expect, it } from 'vitest';
import {
  discordJourneyReceiptCanary,
  sanitizeDiscordJourneyReceipt,
} from '../src/platform/discord-journey-receipt.js';

const input = () => ({
  repositoryVersion: '1.5.0',
  nodeVersion: 'v22.1.0',
  scenarioIds: ['command-ask'],
  testFiles: ['tests/commands.test.ts'],
  counts: {
    totalScenarios: 1,
    verifiedAutomated: 1,
    manualRequired: 0,
    configurationDependent: 0,
    defectLinked: 0,
    notApplicable: 0,
    totalFiles: 1,
    passedFiles: 1,
    failedFiles: 0,
  },
  durationMs: 5,
  exitStatus: 0,
  diagnostic: {
    canary: discordJourneyReceiptCanary,
    token: `Bearer ${discordJourneyReceiptCanary}`,
    path: 'C:\\private',
    id: '123456789012345678',
    url: 'https://example.invalid',
    content: 'raw message',
  },
});

describe('Discord journey receipt', () => {
  it('keeps only the fixed aggregate allowlist and proves the canary was removed', () => {
    const receipt = sanitizeDiscordJourneyReceipt(input());
    expect(receipt.redactionPassed).toBe(true);
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain(discordJourneyReceiptCanary);
    expect(serialized).not.toMatch(
      /[A-Z]:\\|https?:\/\/|123456789012345678|raw message|Bearer/i,
    );
    expect(Object.keys(receipt).sort()).toEqual(
      [
        'counts',
        'durationMs',
        'exitStatus',
        'nodeVersion',
        'redactionPassed',
        'repositoryVersion',
        'scenarioIds',
        'testFiles',
      ].sort(),
    );
  });

  it('rejects raw paths, URLs, IDs, or malformed evidence in allowlisted fields', () => {
    for (const testFile of [
      'C:\\private\\x.test.ts',
      'https://example.invalid/x.test.ts',
      'tests/123456789012345678.test.ts',
      '../tests/x.test.ts',
    ]) {
      expect(() =>
        sanitizeDiscordJourneyReceipt({ ...input(), testFiles: [testFile] }),
      ).toThrow(/invalid evidence/i);
    }
  });

  it('rejects aggregate counts that do not reconcile', () => {
    expect(() =>
      sanitizeDiscordJourneyReceipt({
        ...input(),
        counts: { ...input().counts, totalScenarios: 2 },
      }),
    ).toThrow(/invalid evidence/i);
  });
});
