import type { ReminderRecurrence } from './reminder-types.js';

const intervalMilliseconds: Readonly<Record<ReminderRecurrence, number>> = {
  daily: 86_400_000,
  weekly: 604_800_000,
};

export const parseReminderRecurrence = (
  value: string,
): ReminderRecurrence | undefined => {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'daily' || normalized === 'weekly') {
    return normalized;
  }
  return undefined;
};

export const nextReminderDueAt = (
  dueAt: Date,
  recurrence: ReminderRecurrence,
  untilAt: Date,
  after: Date,
): Date | undefined => {
  const dueMs = dueAt.getTime();
  const untilMs = untilAt.getTime();
  const afterMs = after.getTime();
  const interval = intervalMilliseconds[recurrence];
  if (
    !Number.isFinite(dueMs) ||
    !Number.isFinite(untilMs) ||
    !Number.isFinite(afterMs) ||
    !Number.isSafeInteger(interval)
  ) {
    return undefined;
  }

  let next = dueMs + interval;
  while (next <= untilMs) {
    if (next > afterMs) {
      return new Date(next);
    }
    next += interval;
  }
  return undefined;
};
