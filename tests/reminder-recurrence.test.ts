import { describe, expect, it } from 'vitest';

import {
  nextReminderDueAt,
  parseReminderRecurrence,
} from '../src/reminders/reminder-recurrence.js';

const due = new Date('2026-08-29T12:00:00.000Z');

describe('reminder recurrence', () => {
  it.each(['daily', ' weekly ', 'DAILY'] as const)(
    'parses recurrence %s',
    (input) => {
      expect(parseReminderRecurrence(input)).toBe(input.trim().toLowerCase());
    },
  );

  it.each(['monthly', '', 'every day', 'biweekly'])(
    'rejects unsupported recurrence %s',
    (input) => expect(parseReminderRecurrence(input)).toBeUndefined(),
  );

  it('advances a daily reminder by one day when that slot is still in bounds', () => {
    expect(
      nextReminderDueAt(
        due,
        'daily',
        new Date('2026-09-05T12:00:00.000Z'),
        due,
      ),
    ).toEqual(new Date('2026-08-30T12:00:00.000Z'));
  });

  it('advances a weekly reminder by seven days when that slot is still in bounds', () => {
    expect(
      nextReminderDueAt(
        due,
        'weekly',
        new Date('2026-09-26T12:00:00.000Z'),
        due,
      ),
    ).toEqual(new Date('2026-09-05T12:00:00.000Z'));
  });

  it('skips missed slots so the next fire is after the delivery time', () => {
    expect(
      nextReminderDueAt(
        due,
        'daily',
        new Date('2026-09-05T12:00:00.000Z'),
        new Date('2026-08-31T12:00:00.000Z'),
      ),
    ).toEqual(new Date('2026-09-01T12:00:00.000Z'));
  });

  it('returns undefined when the next slot would pass the until bound', () => {
    expect(
      nextReminderDueAt(
        due,
        'daily',
        new Date('2026-08-29T18:00:00.000Z'),
        due,
      ),
    ).toBeUndefined();
  });

  it('includes a next slot that lands exactly on the until bound', () => {
    expect(
      nextReminderDueAt(
        due,
        'daily',
        new Date('2026-08-30T12:00:00.000Z'),
        due,
      ),
    ).toEqual(new Date('2026-08-30T12:00:00.000Z'));
  });

  it('skips a slot that lands exactly on the delivery time', () => {
    expect(
      nextReminderDueAt(
        due,
        'daily',
        new Date('2026-09-05T12:00:00.000Z'),
        new Date('2026-08-30T12:00:00.000Z'),
      ),
    ).toEqual(new Date('2026-08-31T12:00:00.000Z'));
  });

  it('skips missed weekly slots so the next fire is after the delivery time', () => {
    expect(
      nextReminderDueAt(
        due,
        'weekly',
        new Date('2026-10-10T12:00:00.000Z'),
        new Date('2026-09-12T12:00:00.000Z'),
      ),
    ).toEqual(new Date('2026-09-19T12:00:00.000Z'));
  });

  it.each([
    [new Date(Number.NaN), new Date('2026-09-05T12:00:00.000Z'), due],
    [due, new Date(Number.NaN), due],
    [due, new Date('2026-09-05T12:00:00.000Z'), new Date(Number.NaN)],
  ])(
    'returns undefined when due, until, or after is not a finite date',
    (dueAt, untilAt, after) => {
      expect(nextReminderDueAt(dueAt, 'daily', untilAt, after)).toBeUndefined();
    },
  );
});
