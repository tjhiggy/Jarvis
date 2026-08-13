export interface ModerationWarning {
  readonly serverId: string;
  readonly warningId: string;
  readonly actorId: string;
  readonly subjectId: string;
  readonly reason: string;
  readonly at: string;
}

const id = /^[0-9]{8,20}$/;
export function createModerationWarning(input: ModerationWarning): ModerationWarning {
  for (const value of [input.serverId, input.warningId, input.actorId, input.subjectId]) {
    if (!id.test(value)) throw new Error('invalid moderation warning identifier');
  }
  const reason = input.reason.trim();
  if (!reason || reason.length > 500 || /<@(?:!|&)?\d{8,20}>|@(everyone|here)/i.test(reason)) {
    throw new Error('invalid moderation warning reason');
  }
  const at = new Date(input.at);
  if (Number.isNaN(at.getTime())) throw new Error('invalid moderation warning timestamp');
  return Object.freeze({ ...input, reason, at: at.toISOString() });
}

export function redactModerationWarning(warning: ModerationWarning) {
  return { serverId: warning.serverId, warningId: warning.warningId, actorId: warning.actorId, subjectId: warning.subjectId, at: warning.at };
}
