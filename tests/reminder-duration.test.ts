import { describe, expect, it } from 'vitest';

import { parseReminderDuration } from '../src/reminders/reminder-duration.js';
import {
  createReminderId,
  createReminderLeaseId,
} from '../src/reminders/reminder-identity.js';

describe('reminder duration and identity', () => {
  it.each([
    ['1 minute', 60_000, '1 minute'],
    ['10 minutes', 600_000, '10 minutes'],
    ['2 hours', 7_200_000, '2 hours'],
    ['30 days', 2_592_000_000, '30 days'],
  ])('parses %s', (input, milliseconds, canonical) => {
    expect(parseReminderDuration(input)).toEqual({ milliseconds, canonical });
  });

  it.each(['59 seconds', '0 minutes', '31 days', 'tomorrow', '1.5 hours', ''])(
    'rejects unsupported duration %s',
    (input) => expect(parseReminderDuration(input)).toBeUndefined(),
  );

  it('creates opaque base32 reminder identities', () => {
    const deterministicBytes = () => Buffer.alloc(16, 7);

    expect(createReminderId(deterministicBytes)).toMatch(/^[a-z2-7]{12}$/);
    expect(createReminderLeaseId(deterministicBytes)).toMatch(/^[a-z2-7]{12}$/);
  });
});
