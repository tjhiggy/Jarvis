import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isAbsolute, relative, resolve } from 'node:path';

export const discordJourneyKinds = [
  'command',
  'feature',
  'state',
  'configuration',
  'manual',
  'safety',
] as const;
export type DiscordJourneyKind = (typeof discordJourneyKinds)[number];
export const discordJourneyOutcomes = [
  'verified-automated',
  'manual-required',
  'configuration-dependent',
  'defect-linked',
  'not-applicable',
] as const;
export type DiscordJourneyOutcome = (typeof discordJourneyOutcomes)[number];

export const normalizeDiscordJourneyMatrix = (matrix: string): string =>
  matrix.replace(/\r\n/g, '\n');

export interface DiscordJourney {
  id: string;
  kind: DiscordJourneyKind;
  command?: string;
  entryPoint: string;
  state: string;
  visibility: 'private' | 'public' | 'mixed' | 'not-applicable';
  configuration: string;
  permission: string;
  evidence: DiscordJourneyEvidence;
  outcome: DiscordJourneyOutcome;
  manualObligation?: string;
  defect?: string;
}

export interface DiscordJourneyEvidence {
  registration: string;
  routing: string;
  visibility: string;
  state: string;
  permission: string;
}

export function validateDiscordJourneys(
  journeys: readonly DiscordJourney[],
  registeredCommands: readonly string[],
  repositoryRootInput: URL | string,
): void {
  const repositoryRoot =
    repositoryRootInput instanceof URL
      ? fileURLToPath(repositoryRootInput)
      : repositoryRootInput;
  const ids = new Set<string>();
  const ownedCommands = new Set<string>();
  const registered = new Set(registeredCommands);
  const kinds = new Set<DiscordJourneyKind>();

  for (const journey of journeys) {
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(journey.id)) {
      throw new Error('Journey ID must be a non-blank kebab-case identifier.');
    }
    if (ids.has(journey.id))
      throw new Error(`Duplicate journey ID: ${journey.id}`);
    ids.add(journey.id);
    if (!discordJourneyKinds.includes(journey.kind))
      throw new Error(`Unknown journey kind: ${journey.kind}`);
    kinds.add(journey.kind);
    if (!discordJourneyOutcomes.includes(journey.outcome))
      throw new Error(`Unknown journey outcome: ${journey.outcome}`);
    for (const [label, value] of [
      ['entry point', journey.entryPoint],
      ['state', journey.state],
      ['configuration', journey.configuration],
      ['permission', journey.permission],
    ] as const) {
      if (!value.trim())
        throw new Error(`Journey ${journey.id} must include ${label}.`);
    }
    if (journey.kind === 'command') {
      if (!journey.command || !registered.has(journey.command))
        throw new Error(`Journey ${journey.id} owns an unregistered command.`);
      if (ownedCommands.has(journey.command))
        throw new Error(`Duplicate command ownership: ${journey.command}`);
      ownedCommands.add(journey.command);
    }
    if (
      journey.outcome === 'manual-required' &&
      !journey.manualObligation?.trim()
    ) {
      throw new Error(
        `Journey ${journey.id} must include a manual obligation.`,
      );
    }
    if (
      journey.outcome === 'defect-linked' &&
      !/^#[1-9]\d*$/.test(journey.defect ?? '')
    ) {
      throw new Error(
        `Journey ${journey.id} must include a focused defect reference.`,
      );
    }
    for (const [obligation, evidence] of Object.entries(journey.evidence)) {
      if (!evidence.trim()) {
        throw new Error(
          `Journey ${journey.id} must include ${obligation} evidence.`,
        );
      }
      validateEvidence(evidence, repositoryRoot);
    }
    rejectUnsafeCatalogText(journey);
  }
  for (const command of registeredCommands) {
    if (!ownedCommands.has(command))
      throw new Error(`Missing registered command journey: ${command}`);
  }
  if (ownedCommands.size !== registered.size)
    throw new Error('Command journey ownership does not match registration.');
  if (journeys.some((journey) => journey.kind !== 'command')) {
    for (const kind of discordJourneyKinds) {
      if (!kinds.has(kind))
        throw new Error(`Missing required journey kind: ${kind}`);
    }
  }
}

export function renderDiscordJourneyMatrix(
  journeys: readonly DiscordJourney[],
  registeredCommands: readonly string[],
  repositoryRoot: URL | string,
): string {
  validateDiscordJourneys(journeys, registeredCommands, repositoryRoot);
  const rows = [...journeys]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((journey) =>
      [
        journey.id,
        journey.kind,
        journey.command ? `\`/${journey.command}\`` : journey.entryPoint,
        journey.state,
        journey.visibility,
        journey.configuration,
        journey.permission,
        Object.entries(journey.evidence)
          .map(([name, file]) => `${name}: \`${file}\``)
          .join('; '),
        journey.outcome,
        journey.manualObligation ?? 'None',
        journey.defect ?? 'None',
      ].map(escapeCell),
    );
  return [
    '# Discord Journey Verification Matrix',
    '',
    'This deterministic matrix owns every registered Discord command and the cross-cutting feature, state, configuration, manual, and safety obligations. File references are supporting regressions, not exact per-obligation proof unless an exact named assertion is added later. Focused child processes remove inherited credentials, but the verifier does not sandbox filesystem or network access. Live registration, deployed permissions, state, visibility, and mobile rendering remain explicit non-automated outcomes.',
    '',
    table(
      [
        'ID',
        'Kind',
        'Entry point',
        'State',
        'Visibility',
        'Configuration',
        'Permission',
        'Supporting regression files',
        'Outcome',
        'Manual obligation',
        'Defect',
      ],
      rows,
    ),
    '',
  ].join('\n');
}

function validateEvidence(evidence: string, root: string): void {
  if (
    isAbsolute(evidence) ||
    !/^tests(?:\/[^/]+)*\/[^/]+\.test\.ts$/.test(evidence) ||
    evidence.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(
      'Evidence must be a safe repository-relative tests/**/*.test.ts path.',
    );
  }
  const resolvedRoot = resolve(root);
  const resolvedEvidence = resolve(resolvedRoot, evidence);
  if (!existsSync(resolvedEvidence))
    throw new Error('Evidence file does not exist.');
  if (lstatSync(resolvedEvidence).isSymbolicLink())
    throw new Error('Evidence path must not be a symbolic link.');
  const contained = relative(
    realpathSync(resolvedRoot),
    realpathSync(resolvedEvidence),
  );
  if (
    !contained ||
    contained === '..' ||
    contained.startsWith('../') ||
    contained.startsWith('..\\') ||
    isAbsolute(contained)
  ) {
    throw new Error(
      'Resolved evidence path must remain inside the repository.',
    );
  }
}

function rejectUnsafeCatalogText(journey: DiscordJourney): void {
  const text = Object.values(journey).join(' ');
  if (
    /(?:canary[-_ ]?(?:secret|token|key|value)?|private[-_ ]?data|Bearer\s|[A-Z]:\\|\/Users\/|\b\d{17,20}\b)/i.test(
      text,
    )
  ) {
    throw new Error(
      'Unsafe secret, identifier, content, or raw path in journey catalog.',
    );
  }
}

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}
function table(header: string[], rows: string[][]): string {
  const widths = header.map((cell, i) =>
    Math.max(cell.length, ...rows.map((row) => row[i]?.length ?? 0)),
  );
  const row = (cells: string[]) =>
    `| ${cells.map((cell, i) => cell.padEnd(widths[i]!)).join(' | ')} |`;
  return [
    row(header),
    `| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`,
    ...rows.map(row),
  ].join('\n');
}
