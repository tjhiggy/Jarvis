import { stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export type FeatureVerificationStatus =
  'pass' | 'fail' | 'blocked' | 'not-applicable';

export type FeatureAudience = 'member' | 'administrator' | 'operator' | 'mixed';

export interface FeatureVerificationRecord {
  readonly id: string;
  readonly name: string;
  readonly status: FeatureVerificationStatus;
  readonly ownerModule: string;
  readonly entryPoints: {
    readonly discordCommands: readonly string[];
    readonly commandDeckWorkflows: readonly string[];
  };
  readonly audience: FeatureAudience;
  readonly requiredConfiguration: readonly string[];
  readonly permissionBoundary: string;
  readonly persistenceBehavior: string;
  readonly automatedEvidence: readonly string[];
  readonly manualSmokeCases: readonly string[];
  readonly blockingReason?: string;
  readonly defectIssues?: readonly number[];
}

export interface FeatureVerificationFinding {
  readonly code:
    | 'command-duplicated'
    | 'command-unowned'
    | 'configuration-invalid'
    | 'evidence-invalid'
    | 'evidence-missing'
    | 'feature-duplicated'
    | 'record-incomplete'
    | 'status-invalid'
    | 'workflow-duplicated'
    | 'workflow-unowned';
  readonly message: string;
}

export interface FeatureVerificationResult {
  readonly records: readonly FeatureVerificationRecord[];
  readonly findings: readonly FeatureVerificationFinding[];
  readonly registeredCommandCount: number;
  readonly ownedCommandCount: number;
  readonly registeredWorkflowCount: number;
  readonly ownedWorkflowCount: number;
  readonly shippable: boolean;
}

interface RegisteredCommand {
  readonly name: string;
}

interface RegisteredWorkflow {
  readonly id: string;
}

const audienceLabel: Readonly<Record<FeatureAudience, string>> = {
  member: 'Member',
  administrator: 'Administrator',
  operator: 'Operator',
  mixed: 'Mixed',
};

const nonEmpty = (value: string): boolean => value.trim().length > 0;

const formatList = (values: readonly string[], empty = 'None'): string =>
  values.length > 0 ? values.join(', ') : empty;

const formatCommands = (commands: readonly string[]): string =>
  commands.length > 0
    ? commands.map((command) => `\`/${command}\``).join(', ')
    : 'None';

const validateRecordShape = (
  record: FeatureVerificationRecord,
): readonly FeatureVerificationFinding[] => {
  const findings: FeatureVerificationFinding[] = [];
  const requiredText = [
    record.id,
    record.name,
    record.ownerModule,
    record.permissionBoundary,
    record.persistenceBehavior,
  ];
  const requiredLists = [record.automatedEvidence, record.manualSmokeCases];

  if (
    requiredText.some((value) => !nonEmpty(value)) ||
    requiredLists.some(
      (values) =>
        values.length === 0 || values.some((value) => !nonEmpty(value)),
    )
  ) {
    findings.push({
      code: 'record-incomplete',
      message: `Feature ${record.id || '(missing id)'} has incomplete verification metadata.`,
    });
  }

  if (
    (record.status === 'blocked' || record.status === 'fail') &&
    !nonEmpty(record.blockingReason ?? '')
  ) {
    findings.push({
      code: 'status-invalid',
      message: `Feature ${record.id} is ${record.status} without a blocking reason.`,
    });
  }

  if (record.status === 'pass' && nonEmpty(record.blockingReason ?? '')) {
    findings.push({
      code: 'status-invalid',
      message: `Feature ${record.id} passes but still has a blocking reason.`,
    });
  }

  for (const key of record.requiredConfiguration) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
      findings.push({
        code: 'configuration-invalid',
        message: `Feature ${record.id} has invalid configuration key ${key}.`,
      });
    }
  }

  if (
    record.status === 'not-applicable' &&
    (record.entryPoints.discordCommands.length > 0 ||
      record.entryPoints.commandDeckWorkflows.length > 0)
  ) {
    findings.push({
      code: 'status-invalid',
      message: `Feature ${record.id} is not-applicable but owns runtime entry points.`,
    });
  }

  return findings;
};

export const validateFeatureCatalog = async (
  records: readonly FeatureVerificationRecord[],
  registeredCommands: readonly RegisteredCommand[],
  registeredWorkflows: readonly RegisteredWorkflow[],
  repositoryRoot: string,
): Promise<FeatureVerificationResult> => {
  const findings: FeatureVerificationFinding[] = [];
  const featureIds = new Map<string, number>();
  const commandOwners = new Map<string, string[]>();
  const workflowOwners = new Map<string, string[]>();
  const absoluteRepositoryRoot = resolve(repositoryRoot);

  for (const record of records) {
    findings.push(...validateRecordShape(record));
    featureIds.set(record.id, (featureIds.get(record.id) ?? 0) + 1);

    for (const command of record.entryPoints.discordCommands) {
      const owners = commandOwners.get(command) ?? [];
      owners.push(record.id);
      commandOwners.set(command, owners);
    }

    for (const workflow of record.entryPoints.commandDeckWorkflows) {
      const owners = workflowOwners.get(workflow) ?? [];
      owners.push(record.id);
      workflowOwners.set(workflow, owners);
    }

    for (const evidence of record.automatedEvidence) {
      const absoluteEvidence = resolve(absoluteRepositoryRoot, evidence);
      const repositoryRelativePath = relative(
        absoluteRepositoryRoot,
        absoluteEvidence,
      );
      if (
        repositoryRelativePath.startsWith('..') ||
        isAbsolute(repositoryRelativePath)
      ) {
        findings.push({
          code: 'evidence-invalid',
          message: `Feature ${record.id} cites evidence outside the repository: ${evidence}.`,
        });
        continue;
      }
      if (!/^tests[/\\].+\.test\.ts$/.test(repositoryRelativePath)) {
        findings.push({
          code: 'evidence-invalid',
          message: `Feature ${record.id} evidence is not a Vitest test file: ${evidence}.`,
        });
        continue;
      }
      try {
        const evidenceStat = await stat(absoluteEvidence);
        if (!evidenceStat.isFile()) throw new Error('not a file');
      } catch {
        findings.push({
          code: 'evidence-missing',
          message: `Feature ${record.id} cites missing evidence ${evidence}.`,
        });
      }
    }

    try {
      const ownerPath = resolve(absoluteRepositoryRoot, record.ownerModule);
      const ownerRelativePath = relative(absoluteRepositoryRoot, ownerPath);
      const ownerStat = await stat(ownerPath);
      if (
        ownerRelativePath.startsWith('..') ||
        isAbsolute(ownerRelativePath) ||
        !/^src[/\\].+\.ts$/.test(ownerRelativePath) ||
        !ownerStat.isFile()
      ) {
        throw new Error('invalid owner');
      }
    } catch {
      findings.push({
        code: 'evidence-missing',
        message: `Feature ${record.id} cites missing evidence ${record.ownerModule}.`,
      });
    }
  }

  for (const [id, count] of featureIds) {
    if (count > 1) {
      findings.push({
        code: 'feature-duplicated',
        message: `Feature ID ${id} appears ${count} times.`,
      });
    }
  }

  const registeredNames = new Set(
    registeredCommands.map(({ name }) => name.trim()),
  );
  for (const name of [...registeredNames].sort()) {
    const owners = commandOwners.get(name) ?? [];
    if (owners.length === 0) {
      findings.push({
        code: 'command-unowned',
        message: `Registered Discord command /${name} has no feature owner.`,
      });
    } else if (owners.length > 1) {
      findings.push({
        code: 'command-duplicated',
        message: `Registered Discord command /${name} is owned by multiple features: ${owners.join(', ')}.`,
      });
    }
  }

  for (const [name, owners] of commandOwners) {
    if (!registeredNames.has(name)) {
      findings.push({
        code: 'record-incomplete',
        message: `Feature ${owners.join(', ')} owns unregistered Discord command /${name}.`,
      });
    }
  }

  const registeredWorkflowIds = new Set(
    registeredWorkflows.map(({ id }) => id.trim()),
  );
  for (const id of [...registeredWorkflowIds].sort()) {
    const owners = workflowOwners.get(id) ?? [];
    if (owners.length === 0) {
      findings.push({
        code: 'workflow-unowned',
        message: `Command Deck workflow ${id} has no feature owner.`,
      });
    } else if (owners.length > 1) {
      findings.push({
        code: 'workflow-duplicated',
        message: `Command Deck workflow ${id} is owned by multiple features: ${owners.join(', ')}.`,
      });
    }
  }

  for (const [id, owners] of workflowOwners) {
    if (!registeredWorkflowIds.has(id)) {
      findings.push({
        code: 'record-incomplete',
        message: `Feature ${owners.join(', ')} owns unregistered Command Deck workflow ${id}.`,
      });
    }
  }

  const sortedFindings = findings.sort((left, right) =>
    `${left.code}:${left.message}`.localeCompare(
      `${right.code}:${right.message}`,
    ),
  );
  const nonPassingRecord = records.some(
    ({ status }) => status === 'blocked' || status === 'fail',
  );

  return {
    records,
    findings: sortedFindings,
    registeredCommandCount: registeredNames.size,
    ownedCommandCount: [...registeredNames].filter(
      (name) => (commandOwners.get(name) ?? []).length === 1,
    ).length,
    registeredWorkflowCount: registeredWorkflowIds.size,
    ownedWorkflowCount: [...registeredWorkflowIds].filter(
      (id) => (workflowOwners.get(id) ?? []).length === 1,
    ).length,
    shippable: sortedFindings.length === 0 && !nonPassingRecord,
  };
};

export const renderFeatureVerificationReport = (
  result: FeatureVerificationResult,
): string => {
  const lines = [
    '# Jarvis shipped-feature verification matrix',
    '',
    '> Generated by `npm run features:write`. Do not edit this file by hand.',
    '',
    `**Release readiness:** ${result.shippable ? 'PASS' : 'NOT READY'}`,
    '',
    '| Feature | Status | Audience | Discord commands | Command Deck workflows |',
    '| --- | --- | --- | --- | --- |',
  ];

  for (const record of result.records) {
    lines.push(
      `| ${record.name} | ${record.status} | ${audienceLabel[record.audience]} | ${formatCommands(record.entryPoints.discordCommands)} | ${formatList(record.entryPoints.commandDeckWorkflows)} |`,
    );
  }

  lines.push('', '## Verification details', '');
  for (const record of result.records) {
    lines.push(
      `### ${record.name}`,
      '',
      `- Status: **${record.status}**`,
      `- Owner: \`${record.ownerModule}\``,
      `- Configuration: ${formatList(
        record.requiredConfiguration.map((key) => `\`${key}\``),
        'None',
      )}`,
      `- Permissions: ${record.permissionBoundary}`,
      `- Persistence: ${record.persistenceBehavior}`,
      `- Automated: ${record.automatedEvidence.map((path) => `\`${path}\``).join(', ')}`,
      ...record.manualSmokeCases.map((smoke) => `- Smoke: ${smoke}`),
    );
    if (record.blockingReason !== undefined) {
      lines.push(`- Blocker: ${record.blockingReason}`);
    }
    if ((record.defectIssues ?? []).length > 0) {
      lines.push(
        `- Defects: ${record.defectIssues?.map((issue) => `[#${issue}](https://github.com/tjhiggy/Jarvis/issues/${issue})`).join(', ')}`,
      );
    }
    lines.push('');
  }

  lines.push(
    '## Reconciliation summary',
    '',
    `- Feature records: ${result.records.length}`,
    `- Registered Discord commands: ${result.registeredCommandCount}`,
    `- Commands with exactly one owner: ${result.ownedCommandCount}`,
    `- Registered Command Deck workflows: ${result.registeredWorkflowCount}`,
    `- Workflows with exactly one owner: ${result.ownedWorkflowCount}`,
    `- Findings: ${result.findings.length}`,
  );

  if (result.findings.length > 0) {
    lines.push('', '## Findings', '');
    lines.push(
      ...result.findings.map(
        (finding) => `- **${finding.code}:** ${finding.message}`,
      ),
    );
  }

  return `${lines.join('\n')}\n`;
};
