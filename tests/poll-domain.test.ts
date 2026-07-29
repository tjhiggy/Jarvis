import { describe, expect, it } from 'vitest';
import { PollCoordinator } from '../src/polls/poll-coordinator.js';
import { createPollId, createVoterKey } from '../src/polls/poll-identity.js';
import { validatePollInput } from '../src/polls/poll-validation.js';

const validInput = {
  question: 'What should the crew play?',
  options: ['ARC Raiders', 'Helldivers 2'],
  duration: '1h',
};

describe('validatePollInput', () => {
  it.each([
    { question: '  Ship status?  ', expected: 'Ship status?' },
    { question: 'x'.repeat(200), expected: 'x'.repeat(200) },
    { question: '🚀'.repeat(200), expected: '🚀'.repeat(200) },
  ])('accepts and trims valid Unicode questions', ({ question, expected }) => {
    expect(validatePollInput({ ...validInput, question }).question).toBe(
      expected,
    );
  });

  it.each(['', '   ', 'x'.repeat(201), '🚀'.repeat(201)])(
    'rejects question outside the 1-to-200 code-point limit',
    (question) => {
      expect(() => validatePollInput({ ...validInput, question })).toThrow(
        /question/i,
      );
    },
  );

  it.each([
    { options: ['  Flash  ', 'AlienBoi'], expected: ['Flash', 'AlienBoi'] },
    {
      options: ['x'.repeat(80), '🚀'.repeat(80)],
      expected: ['x'.repeat(80), '🚀'.repeat(80)],
    },
  ])('accepts and trims valid Unicode options', ({ options, expected }) => {
    expect(validatePollInput({ ...validInput, options }).options).toEqual(
      expected,
    );
  });

  it.each([
    ['one option', ['Only one']],
    ['six options', ['1', '2', '3', '4', '5', '6']],
    ['blank option', ['Ready', '   ']],
    ['too-long option', ['Ready', 'x'.repeat(81)]],
    ['too-long emoji option', ['Ready', '🚀'.repeat(81)]],
  ])('rejects invalid option sets: %s', (_label, options) => {
    expect(() => validatePollInput({ ...validInput, options })).toThrow(
      /option/i,
    );
  });

  it.each([
    ['case', ['Ready', 'ready']],
    ['whitespace', ['Ready  now', '  Ready\tnow  ']],
    ['Unicode normalization', ['Café', 'Café']],
    ['full Unicode case folding', ['\u0345', '\u03b9']],
  ])(
    'rejects duplicate options after Unicode normalization: %s',
    (_label, options) => {
      expect(() => validatePollInput({ ...validInput, options })).toThrow(
        /unique/i,
      );
    },
  );

  it.each([
    ['15m', 900_000],
    ['1h', 3_600_000],
    ['6h', 21_600_000],
    ['24h', 86_400_000],
    ['3d', 259_200_000],
    ['7d', 604_800_000],
  ])('maps registered duration %s exactly', (duration, durationMs) => {
    expect(validatePollInput({ ...validInput, duration })).toMatchObject({
      duration,
      durationMs,
    });
  });

  it('rejects an unregistered duration', () => {
    expect(() => validatePollInput({ ...validInput, duration: '30m' })).toThrow(
      /duration/i,
    );
  });
});

describe('poll identity', () => {
  it('generates twelve lowercase Base32 characters', () => {
    const id = createPollId(() => Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]));

    expect(id).toMatch(/^[a-z2-7]{12}$/);
    expect(id).toHaveLength(12);
  });

  it('creates poll-scoped anonymous HMAC voter keys', () => {
    const stable = createVoterKey(
      'a long enough but test-only secret',
      'guild-1',
      'poll-1',
      'user-1',
    );

    expect(
      createVoterKey(
        'a long enough but test-only secret',
        'guild-1',
        'poll-1',
        'user-1',
      ),
    ).toBe(stable);
    expect(
      createVoterKey(
        'a long enough but test-only secret',
        'guild-1',
        'poll-1',
        'user-2',
      ),
    ).not.toBe(stable);
    expect(
      createVoterKey(
        'a long enough but test-only secret',
        'guild-1',
        'poll-2',
        'user-1',
      ),
    ).not.toBe(stable);
    expect(
      createVoterKey(
        'a long enough but test-only secret',
        'guild-2',
        'poll-1',
        'user-1',
      ),
    ).not.toBe(stable);
    expect(
      createVoterKey('another test-only secret', 'guild-1', 'poll-1', 'user-1'),
    ).not.toBe(stable);
    expect(stable).not.toContain('guild-1');
    expect(stable).not.toContain('poll-1');
    expect(stable).not.toContain('user-1');
  });
});

describe('PollCoordinator', () => {
  it('runs operations for one poll in submission order', async () => {
    const coordinator = new PollCoordinator();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = coordinator.run('poll-a', async () => {
      events.push('first:start');
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      events.push('first:end');
    });
    const second = coordinator.run('poll-a', async () => {
      events.push('second');
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(events).toEqual(['first:start']);
    releaseFirst?.();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second']);
  });

  it('allows different polls to proceed independently and releases keyed state', async () => {
    const coordinator = new PollCoordinator();
    let releaseFirst: (() => void) | undefined;
    let otherStarted = false;
    const first = coordinator.run('poll-a', async () => {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    });
    const other = coordinator.run('poll-b', async () => {
      otherStarted = true;
    });

    await other;
    expect(otherStarted).toBe(true);
    releaseFirst?.();
    await first;
    await coordinator.run('poll-a', async () => {
      otherStarted = true;
    });
    expect(coordinator.size).toBe(0);
  });
});
