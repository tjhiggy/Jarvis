import { describe, expect, it } from 'vitest';
import { resolveIntroductionDisplayName } from '../src/commands/introduction.js';

describe('resolveIntroductionDisplayName', () => {
  it('prefers a non-empty custom name', () => {
    expect(
      resolveIntroductionDisplayName(
        {
          member: { displayName: 'Crew' },
          user: { id: 'u1', globalName: 'Global', username: 'user' },
        },
        '  Preferred  ',
      ),
    ).toBe('Preferred');
  });

  it('falls back through member display name, global name, and username', () => {
    expect(
      resolveIntroductionDisplayName(
        {
          member: { displayName: 'Member Name' },
          user: { id: 'u1', globalName: 'Global', username: 'user' },
        },
        null,
      ),
    ).toBe('Member Name');
    expect(
      resolveIntroductionDisplayName(
        {
          member: { displayName: '  ' },
          user: { id: 'u1', globalName: 'Global', username: 'user' },
        },
        null,
      ),
    ).toBe('Global');
    expect(
      resolveIntroductionDisplayName(
        {
          member: null,
          user: { id: 'u1', globalName: null, username: 'user' },
        },
        null,
      ),
    ).toBe('user');
  });

  it('uses a safe fallback when Discord identity fields are unavailable', () => {
    expect(
      resolveIntroductionDisplayName(
        {
          member: null,
          user: { id: 'u1', globalName: null },
        },
        null,
      ),
    ).toBe('Crew Member');
  });
});
