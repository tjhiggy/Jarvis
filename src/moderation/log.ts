export type ModerationLogAction =
  'warning' | 'automod_flag' | 'raid_signal' | 'pause' | 'resume';
export interface ModerationLogEntry {
  readonly serverId: string;
  readonly action: ModerationLogAction;
  readonly actorId?: string;
  readonly subjectId?: string;
  readonly outcome: 'recorded' | 'flagged' | 'suppressed';
  readonly at: string;
}
const id = /^[0-9]{8,20}$/;
export function createModerationLogEntry(
  input: ModerationLogEntry,
): ModerationLogEntry {
  if (
    !id.test(input.serverId) ||
    (input.actorId !== undefined && !id.test(input.actorId)) ||
    (input.subjectId !== undefined && !id.test(input.subjectId))
  )
    throw new Error('invalid moderation log identifier');
  const at = new Date(input.at);
  if (Number.isNaN(at.getTime()))
    throw new Error('invalid moderation log timestamp');
  return Object.freeze({ ...input, at: at.toISOString() });
}
export function redactModerationLog(entry: ModerationLogEntry) {
  return {
    serverId: entry.serverId,
    action: entry.action,
    actorId: entry.actorId,
    subjectId: entry.subjectId,
    outcome: entry.outcome,
    at: entry.at,
  };
}
