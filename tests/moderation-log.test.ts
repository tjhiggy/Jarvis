import { describe, expect, it } from 'vitest';
import {
  createModerationLogEntry,
  redactModerationLog,
} from '../src/moderation/log.js';
describe('moderation log boundary', () => {
  it('keeps only scoped metadata', () => {
    const entry = createModerationLogEntry({
      serverId: '12345678',
      action: 'automod_flag',
      actorId: '12345679',
      subjectId: '12345680',
      outcome: 'flagged',
      at: '2026-08-13T20:00:00Z',
    });
    expect(redactModerationLog(entry)).toEqual(entry);
  });
  it('rejects malformed identifiers and timestamps', () => {
    expect(() =>
      createModerationLogEntry({
        serverId: 'x',
        action: 'pause',
        outcome: 'recorded',
        at: 'bad',
      }),
    ).toThrow();
  });
});
