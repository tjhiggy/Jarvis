import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

export const requiredRecoveryScenarioGroups = [
  'platform',
  'storage',
  'scheduler',
  'provider',
  'sanitization',
] as const;

export const normalizeRecoveryMatrix = (matrix: string): string =>
  matrix.replace(/\r\n/g, '\n');

export type RecoveryScenarioGroup =
  (typeof requiredRecoveryScenarioGroups)[number];

export interface RecoveryScenario {
  id: string;
  group: RecoveryScenarioGroup;
  claim: string;
  evidence: string;
  recovery: string;
  defect?: string;
}

export interface RecoveryValidationOptions {
  realpath?: (path: string) => string;
}

export function validateRecoveryScenarios(
  scenarios: readonly RecoveryScenario[],
  repositoryRoot: string,
  options: RecoveryValidationOptions = {},
): void {
  const scenarioIds = new Set<string>();
  const representedGroups = new Set<RecoveryScenarioGroup>();

  for (const scenario of scenarios) {
    if (!scenario.id.trim()) {
      throw new Error('Recovery scenario ID must not be blank.');
    }

    if (scenarioIds.has(scenario.id)) {
      throw new Error(`Duplicate scenario ID: ${scenario.id}`);
    }
    scenarioIds.add(scenario.id);

    if (!requiredRecoveryScenarioGroups.includes(scenario.group)) {
      throw new Error(`Unknown recovery scenario group: ${scenario.group}`);
    }
    representedGroups.add(scenario.group);

    if (!scenario.claim.trim()) {
      throw new Error(`Recovery scenario ${scenario.id} must include a claim.`);
    }
    if (!scenario.recovery.trim()) {
      throw new Error(
        `Recovery scenario ${scenario.id} must include recovery guidance.`,
      );
    }
    validateDefectReference(scenario.defect);
    rejectUnsafeText(scenario);
    validateEvidencePath(
      scenario.evidence,
      repositoryRoot,
      options.realpath ?? realpathSync,
    );
  }

  for (const group of requiredRecoveryScenarioGroups) {
    if (!representedGroups.has(group)) {
      throw new Error(`Missing required recovery group: ${group}`);
    }
  }
}

export function renderRecoveryMatrix(
  scenarios: readonly RecoveryScenario[],
  repositoryRoot: string,
): string {
  validateRecoveryScenarios(scenarios, repositoryRoot);

  const rows = [...scenarios]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((scenario) => [
      escapeCell(scenario.id),
      escapeCell(scenario.group),
      escapeCell(scenario.claim),
      `\`${escapeCode(scenario.evidence)}\``,
      escapeCell(scenario.recovery),
      scenario.defect ? escapeCell(scenario.defect) : 'None',
    ]);

  return [
    '# Platform Recovery Verification Matrix',
    '',
    'This deterministic matrix maps the v1.6 recovery claims to disposable, synthetic Vitest evidence. It never reads production configuration, provider credentials, Discord state, or production SQLite data.',
    '',
    renderMarkdownTable(
      ['ID', 'Group', 'Claim', 'Evidence', 'Recovery', 'Defect'],
      rows,
    ),
    '',
  ].join('\n');
}

function validateEvidencePath(
  evidence: string,
  repositoryRoot: string,
  realpath: (path: string) => string,
): void {
  const isTestFile = /^tests(?:\/[^/]+)*\/[^/]+\.test\.ts$/.test(evidence);
  const hasReservedPathSegment = evidence
    .split('/')
    .some((segment) => segment === '.' || segment === '..' || !segment);
  const resolvedRoot = resolve(repositoryRoot);
  const resolvedEvidence = resolve(resolvedRoot, evidence);

  if (isAbsolute(evidence) || hasReservedPathSegment || !isTestFile) {
    throw new Error(
      'Evidence path must be a safe repository-relative tests/**/*.test.ts path.',
    );
  }

  if (!existsSync(resolvedEvidence)) {
    throw new Error('Evidence file does not exist.');
  }

  if (lstatSync(resolvedEvidence).isSymbolicLink()) {
    throw new Error('Evidence path must not be a symbolic link.');
  }

  const realRoot = realpath(resolvedRoot);
  const realEvidence = realpath(resolvedEvidence);
  const relativeEvidence = relative(realRoot, realEvidence);
  const isContained =
    relativeEvidence !== '' &&
    relativeEvidence !== '..' &&
    !relativeEvidence.startsWith('../') &&
    !relativeEvidence.startsWith('..\\') &&
    !isAbsolute(relativeEvidence);

  if (!isContained) {
    throw new Error(
      'Resolved evidence path must remain inside the repository.',
    );
  }
}

function validateDefectReference(defect: string | undefined): void {
  if (defect !== undefined && !/^#[1-9]\d*$/.test(defect)) {
    throw new Error('Defect reference must be a #<positive integer>.');
  }
}

function rejectUnsafeText(scenario: RecoveryScenario): void {
  const values = [
    scenario.id,
    scenario.group,
    scenario.claim,
    scenario.evidence,
    scenario.recovery,
    scenario.defect ?? '',
  ];

  if (
    values.some((value) =>
      /(?:canary[-_ ]?(?:secret|token|key|value)?|private[-_ ]?data)/i.test(
        value,
      ),
    )
  ) {
    throw new Error(
      'Unsafe private-data or canary string in recovery catalog.',
    );
  }
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function escapeCode(value: string): string {
  return value.replaceAll('`', '\\`');
}

function renderMarkdownTable(header: string[], rows: string[][]): string {
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => row[column]?.length ?? 0)),
  );
  const renderRow = (row: string[]) =>
    `| ${row.map((cell, column) => cell.padEnd(widths[column]!)).join(' | ')} |`;

  return [
    renderRow(header),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...rows.map(renderRow),
  ].join('\n');
}
