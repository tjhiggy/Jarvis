import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCommandDefinitions } from '../src/commands/definitions.js';
import {
  discordJourneyCatalog,
  publishedDiscordCommandNames,
} from '../src/platform/discord-journey-catalog.js';
import {
  createDisposableJourneyEnvironment,
  runFocusedJourneyEvidence,
} from '../src/platform/discord-journey-focused-runner.js';
import {
  discordJourneyReceiptCanary,
  sanitizeDiscordJourneyReceipt,
  type DiscordJourneyReceipt,
} from '../src/platform/discord-journey-receipt.js';
import {
  renderDiscordJourneyMatrix,
  normalizeDiscordJourneyMatrix,
  validateDiscordJourneys,
} from '../src/platform/discord-journey-verification.js';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const matrixPath = resolve(
  repositoryRoot,
  'docs/DISCORD_JOURNEY_VERIFICATION.md',
);
const receiptPath = resolve(
  repositoryRoot,
  '.artifacts/qa/discord-journeys.json',
);

await run();

async function run(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  const registeredCommands = createCommandDefinitions(
    2_000,
    [
      {
        id: 'capabilities',
        label: 'Capabilities',
        question: 'What can Jarvis do?',
        answer: 'Synthetic answer.',
      },
    ],
    true,
  ).map((definition) => definition.name);
  if (
    JSON.stringify(registeredCommands) !==
    JSON.stringify(publishedDiscordCommandNames)
  ) {
    throw new Error(
      'The Discord journey command inventory is stale. Reconcile the catalog with command registration.',
    );
  }
  validateDiscordJourneys(
    discordJourneyCatalog,
    registeredCommands,
    repositoryRoot,
  );
  const matrix = renderDiscordJourneyMatrix(
    discordJourneyCatalog,
    registeredCommands,
    repositoryRoot,
  );

  if (mode === 'write') {
    await writeFile(matrixPath, matrix, 'utf8');
    console.log(
      `Discord journey matrix written for ${discordJourneyCatalog.length} scenarios and ${registeredCommands.length} commands.`,
    );
    return;
  }
  await validateMatrix(matrix);
  if (mode === 'check') {
    console.log(
      `Discord journey check passed for ${discordJourneyCatalog.length} scenarios and ${registeredCommands.length} commands.`,
    );
    return;
  }

  const receipt = await verifyEvidence();
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  if (!receipt.redactionPassed)
    throw new Error(
      'Discord journey verification produced unsafe receipt output.',
    );
  if (receipt.exitStatus !== 0) {
    process.exitCode = receipt.exitStatus;
    return;
  }
  console.log(
    `Discord journey verification completed ${receipt.counts.totalFiles} focused test files for ${receipt.counts.totalScenarios} truthful scenarios.`,
  );
}

function parseMode(args: readonly string[]): 'check' | 'write' | 'verify' {
  if (args.length === 0) return 'verify';
  if (args.length === 1 && args[0] === '--check') return 'check';
  if (args.length === 1 && args[0] === '--write') return 'write';
  throw new Error(
    'Use only --check or --write with Discord journey verification.',
  );
}

async function validateMatrix(expected: string): Promise<void> {
  let actual: string;
  try {
    actual = await readFile(matrixPath, 'utf8');
  } catch {
    throw new Error(
      'The Discord journey matrix is missing. Run npm run journeys:write.',
    );
  }
  if (
    normalizeDiscordJourneyMatrix(actual) !==
    normalizeDiscordJourneyMatrix(expected)
  )
    throw new Error(
      'The Discord journey matrix is stale. Run npm run journeys:write and commit the result.',
    );
}

async function verifyEvidence(): Promise<DiscordJourneyReceipt> {
  const started = process.hrtime.bigint();
  const result = await runFocusedJourneyEvidence(
    discordJourneyCatalog,
    runVitest,
  );
  const durationMs = Number((process.hrtime.bigint() - started) / 1_000_000n);
  const packageManifest: unknown = JSON.parse(
    await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'),
  );
  if (
    typeof packageManifest !== 'object' ||
    packageManifest === null ||
    !('version' in packageManifest) ||
    typeof packageManifest.version !== 'string'
  )
    throw new Error(
      'Repository version is unavailable for the journey receipt.',
    );
  const receipt = sanitizeDiscordJourneyReceipt({
    repositoryVersion: packageManifest.version,
    nodeVersion: process.version,
    scenarioIds: discordJourneyCatalog.map((journey) => journey.id),
    testFiles: result.testFiles,
    counts: {
      ...result.counts,
      diagnostic: { canary: discordJourneyReceiptCanary },
    },
    durationMs,
    exitStatus: result.exitStatus,
    diagnostic: {
      canary: discordJourneyReceiptCanary,
      token: `Bearer ${discordJourneyReceiptCanary}`,
      path: `C:\\${discordJourneyReceiptCanary}`,
      id: '123456789012345678',
      url: 'https://example.invalid',
      content: 'synthetic raw message content',
    },
  });
  if (JSON.stringify(receipt).includes(discordJourneyReceiptCanary))
    throw new Error(
      'Discord journey verification produced unsafe receipt output.',
    );
  return receipt;
}

function runVitest(testFile: string): Promise<number> {
  const packagePath = fileURLToPath(import.meta.resolve('vitest/package.json'));
  const entrypoint = resolve(dirname(packagePath), 'vitest.mjs');
  return new Promise((resolveStatus, reject) => {
    const child = spawn(
      process.execPath,
      [entrypoint, 'run', '--silent=true', testFile],
      {
        cwd: repositoryRoot,
        env: createDisposableJourneyEnvironment(process.env),
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    child.once('error', () =>
      reject(new Error('Discord journey verification could not start Vitest.')),
    );
    child.once('exit', (code) => resolveStatus(code ?? 1));
  });
}
