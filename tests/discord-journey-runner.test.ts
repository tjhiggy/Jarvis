import { describe, expect, it } from 'vitest';
import {
  createDisposableJourneyEnvironment,
  runFocusedJourneyEvidence,
} from '../src/platform/discord-journey-focused-runner.js';

describe('focused Discord journey runner', () => {
  it('runs each unique evidence file independently in sorted order', async () => {
    const calls: string[] = [];
    const result = await runFocusedJourneyEvidence(
      [
        {
          id: 'second',
          evidence: 'tests/commands.test.ts',
          outcome: 'verified-automated',
        },
        {
          id: 'first',
          evidence: 'tests/activity.test.ts',
          outcome: 'manual-required',
        },
        {
          id: 'duplicate',
          evidence: 'tests/commands.test.ts',
          outcome: 'configuration-dependent',
        },
      ],
      async (file) => {
        calls.push(file);
        return file.includes('activity') ? 1 : 0;
      },
    );
    expect(calls).toEqual(['tests/activity.test.ts', 'tests/commands.test.ts']);
    expect(result.counts).toMatchObject({
      totalScenarios: 3,
      verifiedAutomated: 1,
      manualRequired: 1,
      configurationDependent: 1,
      totalFiles: 2,
      passedFiles: 1,
      failedFiles: 1,
    });
    expect(result.exitStatus).toBe(1);
  });

  it('collects every command obligation evidence file without inflating scenario counts', async () => {
    const result = await runFocusedJourneyEvidence(
      [
        {
          id: 'command-ask',
          evidence: {
            registration: 'tests/register-commands.test.ts',
            routing: 'tests/commands.test.ts',
            visibility: 'tests/commands.test.ts',
            state: 'tests/handlers.test.ts',
            permission: 'tests/command-permissions.test.ts',
          },
          outcome: 'verified-automated',
        },
      ],
      async () => 0,
    );
    expect(result.counts.totalScenarios).toBe(1);
    expect(result.testFiles).toEqual([
      'tests/command-permissions.test.ts',
      'tests/commands.test.ts',
      'tests/handlers.test.ts',
      'tests/register-commands.test.ts',
    ]);
  });

  it('uses an allowlisted environment without Discord or provider credentials', () => {
    const environment = createDisposableJourneyEnvironment({
      PATH: 'safe-path',
      DISCORD_TOKEN: 'secret',
      OPENAI_API_KEY: 'secret',
      HOME: 'private-path',
    });
    expect(environment.PATH).toBe('safe-path');
    expect(environment.DISCORD_TOKEN).toBeUndefined();
    expect(environment.OPENAI_API_KEY).toBeUndefined();
    expect(environment.HOME).toBeUndefined();
    expect(environment.DISCORD_JOURNEY_FOCUSED_RUNNER).toBe('true');
  });
});
