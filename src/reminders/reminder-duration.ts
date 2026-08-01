import type { ParsedReminderDuration } from './reminder-types.js';

const durationPattern = /^([1-9]\d*)\s+(minute|minutes|hour|hours|day|days)$/i;
const minimumDurationMs = 60_000;
const maximumDurationMs = 2_592_000_000;

const unitMilliseconds: Readonly<Record<string, number>> = {
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

export const parseReminderDuration = (
  value: string,
): ParsedReminderDuration | undefined => {
  const match = durationPattern.exec(value);
  if (match === null) {
    return undefined;
  }

  const quantity = Number(match[1]);
  const unit = match[2]!.toLowerCase().replace(/s$/, '');
  const milliseconds = quantity * unitMilliseconds[unit]!;
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < minimumDurationMs ||
    milliseconds > maximumDurationMs
  ) {
    return undefined;
  }

  return {
    milliseconds,
    canonical: `${quantity} ${unit}${quantity === 1 ? '' : 's'}`,
  };
};
