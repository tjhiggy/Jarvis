export interface DiscordJourneyReceiptCounts {
  totalScenarios: number;
  verifiedAutomated: number;
  manualRequired: number;
  configurationDependent: number;
  defectLinked: number;
  notApplicable: number;
  totalFiles: number;
  passedFiles: number;
  failedFiles: number;
}
export interface DiscordJourneyReceipt {
  repositoryVersion: string;
  nodeVersion: string;
  scenarioIds: string[];
  testFiles: string[];
  counts: DiscordJourneyReceiptCounts;
  durationMs: number;
  exitStatus: number;
  redactionPassed: boolean;
}
export const discordJourneyReceiptCanary =
  'discord-journey-canary-do-not-serialize';

export function sanitizeDiscordJourneyReceipt(
  input: unknown,
): DiscordJourneyReceipt {
  if (
    !record(input) ||
    typeof input.repositoryVersion !== 'string' ||
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(input.repositoryVersion) ||
    typeof input.nodeVersion !== 'string' ||
    !/^v\d+\.\d+\.\d+$/.test(input.nodeVersion) ||
    !ids(input.scenarioIds) ||
    !files(input.testFiles) ||
    !counts(input.counts) ||
    !integer(input.durationMs) ||
    !integer(input.exitStatus) ||
    input.exitStatus > 255
  )
    throw invalid();
  const c = input.counts;
  if (
    c.totalScenarios !== input.scenarioIds.length ||
    c.verifiedAutomated +
      c.manualRequired +
      c.configurationDependent +
      c.defectLinked +
      c.notApplicable !==
      c.totalScenarios ||
    c.totalFiles !== input.testFiles.length ||
    c.passedFiles + c.failedFiles !== c.totalFiles
  )
    throw invalid();
  const output: DiscordJourneyReceipt = {
    repositoryVersion: input.repositoryVersion,
    nodeVersion: input.nodeVersion,
    scenarioIds: [...input.scenarioIds],
    testFiles: [...input.testFiles],
    counts: {
      totalScenarios: c.totalScenarios,
      verifiedAutomated: c.verifiedAutomated,
      manualRequired: c.manualRequired,
      configurationDependent: c.configurationDependent,
      defectLinked: c.defectLinked,
      notApplicable: c.notApplicable,
      totalFiles: c.totalFiles,
      passedFiles: c.passedFiles,
      failedFiles: c.failedFiles,
    },
    durationMs: input.durationMs,
    exitStatus: input.exitStatus,
    redactionPassed: false,
  };
  return {
    ...output,
    redactionPassed:
      contains(input, discordJourneyReceiptCanary) &&
      !JSON.stringify(output).includes(discordJourneyReceiptCanary),
  };
}
function record(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function ids(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        typeof item === 'string' &&
        /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(item) &&
        !/\d{17,20}/.test(item),
    ) &&
    new Set(value).size === value.length
  );
}
function files(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(
      (item) =>
        typeof item === 'string' &&
        /^tests(?:\/[A-Za-z0-9._-]+)*\/[A-Za-z][A-Za-z0-9._-]*\.test\.ts$/.test(
          item,
        ) &&
        !/(?:https?:|[A-Z]:\\|\b\d{17,20}\b|\.\.)/i.test(item),
    ) &&
    new Set(value).size === value.length
  );
}
function counts(value: unknown): value is DiscordJourneyReceiptCounts {
  return (
    record(value) &&
    [
      'totalScenarios',
      'verifiedAutomated',
      'manualRequired',
      'configurationDependent',
      'defectLinked',
      'notApplicable',
      'totalFiles',
      'passedFiles',
      'failedFiles',
    ].every((key) => integer(value[key]))
  );
}
function contains(value: unknown, canary: string): boolean {
  if (typeof value === 'string') return value.includes(canary);
  if (Array.isArray(value))
    return value.some((entry) => contains(entry, canary));
  return (
    record(value) &&
    Object.values(value).some((entry) => contains(entry, canary))
  );
}
function invalid(): Error {
  return new Error(
    'Sanitized Discord journey receipt contains invalid evidence.',
  );
}
