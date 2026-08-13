export type ModerationAction = 'warning_issued' | 'automod_flagged' | 'raid_detected';

export interface ModerationAuditEntry {
  readonly serverId: string;
  readonly action: ModerationAction;
  readonly actorId?: string;
  readonly subjectId?: string;
  readonly outcome: 'observed' | 'confirmed' | 'suppressed';
  readonly at: string;
}

const id = /^[0-9]{8,20}$/;

export function createModerationAuditEntry(input: ModerationAuditEntry): ModerationAuditEntry {
  if (!id.test(input.serverId)) throw new Error('invalid server id');
  if (input.actorId !== undefined && !id.test(input.actorId)) throw new Error('invalid actor id');
  if (input.subjectId !== undefined && !id.test(input.subjectId)) throw new Error('invalid subject id');
  if (!Number.isFinite(Date.parse(input.at))) throw new Error('invalid timestamp');
  return Object.freeze({ ...input });
}

export function redactModerationAudit(entry: ModerationAuditEntry) {
  return {
    serverId: entry.serverId,
    action: entry.action,
    outcome: entry.outcome,
    at: entry.at,
    ...(entry.actorId === undefined ? {} : { actorId: entry.actorId }),
    ...(entry.subjectId === undefined ? {} : { subjectId: entry.subjectId }),
  };
}
