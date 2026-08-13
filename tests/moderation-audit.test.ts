import { describe, expect, it } from 'vitest';
import {
  createModerationAuditEntry,
  redactModerationAudit,
} from '../src/moderation/audit.js';

describe('moderation audit boundary', () => {
  it('accepts bounded metadata and redacts content', () => {
    const entry = createModerationAuditEntry({
      serverId: '12345678',
      action: 'warning_issued',
      actorId: '23456789',
      outcome: 'confirmed',
      at: '2026-08-13T00:00:00Z',
    });
    expect(redactModerationAudit(entry)).toEqual(entry);
  });
  it('rejects malformed identifiers and timestamps', () => {
    expect(() =>
      createModerationAuditEntry({
        serverId: 'x',
        action: 'raid_detected',
        outcome: 'observed',
        at: 'nope',
      }),
    ).toThrow();
  });
});
