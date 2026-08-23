import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { format } from 'prettier';

import { adminConsoleWorkflows } from '../src/admin/admin-console-workflows.js';
import { createCommandDefinitions } from '../src/commands/definitions.js';
import {
  renderFeatureVerificationReport,
  validateFeatureCatalog,
} from '../src/platform/feature-verification.js';
import { shippedFeatureCatalog } from '../src/platform/shipped-feature-catalog.js';

const repositoryRoot = resolve('.');
const reportPath = resolve(
  repositoryRoot,
  'docs/SHIPPED_FEATURE_VERIFICATION.md',
);
const writeMode = process.argv.slice(2).includes('--write');
const unexpectedArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== '--write');

if (unexpectedArguments.length > 0) {
  throw new Error(
    `Unsupported shipped-feature check argument: ${unexpectedArguments.join(', ')}`,
  );
}

const commands = createCommandDefinitions(
  2_000,
  [
    {
      id: 'verification',
      label: 'Verification',
      question: 'Is the command inventory complete?',
      answer: 'The executable shipped-feature check proves command ownership.',
    },
  ],
  true,
);
const result = await validateFeatureCatalog(
  shippedFeatureCatalog,
  commands,
  adminConsoleWorkflows,
  repositoryRoot,
);
const report = await format(renderFeatureVerificationReport(result), {
  parser: 'markdown',
});

if (!result.shippable) {
  for (const finding of result.findings) {
    console.error(`${finding.code}: ${finding.message}`);
  }
  throw new Error('Shipped-feature verification is not release ready.');
}

if (writeMode) {
  await writeFile(reportPath, report, 'utf8');
  console.log(
    `Wrote ${shippedFeatureCatalog.length} shipped feature records covering ${result.ownedCommandCount} Discord commands and ${result.ownedWorkflowCount} Command Deck workflows.`,
  );
} else {
  let committedReport: string;
  try {
    committedReport = await readFile(reportPath, 'utf8');
  } catch {
    throw new Error(
      'The shipped-feature report is missing. Run npm run features:write.',
    );
  }

  if (committedReport !== report) {
    throw new Error(
      'The shipped-feature report is stale. Run npm run features:write and commit the result.',
    );
  }

  console.log(
    `Shipped-feature check passed: ${shippedFeatureCatalog.length} features, ${result.ownedCommandCount} Discord commands, ${result.ownedWorkflowCount} Command Deck workflows, zero findings.`,
  );
}
