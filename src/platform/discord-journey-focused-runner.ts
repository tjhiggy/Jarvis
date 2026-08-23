import type {
  DiscordJourneyEvidence,
  DiscordJourneyOutcome,
} from './discord-journey-verification.js';
import type { DiscordJourneyReceiptCounts } from './discord-journey-receipt.js';

export interface JourneyEvidenceScenario {
  id: string;
  evidence: string | DiscordJourneyEvidence;
  outcome: DiscordJourneyOutcome;
}
export interface FocusedJourneyResult {
  testFiles: string[];
  counts: DiscordJourneyReceiptCounts;
  exitStatus: number;
}
export type FocusedVitestRunner = (testFile: string) => Promise<number>;

export function createDisposableJourneyEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    CI: 'true',
    NODE_ENV: 'test',
    NO_COLOR: '1',
    DISCORD_JOURNEY_FOCUSED_RUNNER: 'true',
  };
  for (const name of [
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
  ]) {
    if (source[name] !== undefined) result[name] = source[name];
  }
  return result;
}

export async function runFocusedJourneyEvidence(
  scenarios: readonly JourneyEvidenceScenario[],
  run: FocusedVitestRunner,
): Promise<FocusedJourneyResult> {
  const testFiles = [
    ...new Set(
      scenarios.flatMap((scenario) =>
        typeof scenario.evidence === 'string'
          ? [scenario.evidence]
          : Object.values(scenario.evidence),
      ),
    ),
  ].sort((a, b) => a.localeCompare(b));
  let passedFiles = 0;
  let failedFiles = 0;
  let exitStatus = 0;
  for (const file of testFiles) {
    const status = await run(file);
    if (status === 0) passedFiles += 1;
    else {
      failedFiles += 1;
      exitStatus ||= status;
    }
  }
  const count = (outcome: DiscordJourneyOutcome) =>
    scenarios.filter((scenario) => scenario.outcome === outcome).length;
  return {
    testFiles,
    counts: {
      totalScenarios: scenarios.length,
      verifiedAutomated: count('verified-automated'),
      manualRequired: count('manual-required'),
      configurationDependent: count('configuration-dependent'),
      defectLinked: count('defect-linked'),
      notApplicable: count('not-applicable'),
      totalFiles: testFiles.length,
      passedFiles,
      failedFiles,
    },
    exitStatus,
  };
}
