import { describe, expect, it } from 'vitest';
import { createModerationWarning, redactModerationWarning } from '../src/moderation/warnings.js';

describe('moderation warnings', () => {
  const base = { serverId: '12345678', warningId: '12345679', actorId: '12345680', subjectId: '12345681', reason: 'Please keep discussion on topic.', at: '2026-08-13T20:00:00Z' };
  it('normalizes valid warnings and redacts reason from audit views', () => {
    const warning = createModerationWarning(base);
    expect(warning.reason).toBe(base.reason);
    expect(redactModerationWarning(warning)).not.toHaveProperty('reason');
  });
  it('rejects unbounded or mention-bearing reasons', () => {
    expect(() => createModerationWarning({ ...base, reason: '@everyone stop' })).toThrow();
    expect(() => createModerationWarning({ ...base, reason: 'x'.repeat(501) })).toThrow();
  });
});
