import { describe, expect, it } from 'vitest';
import {
  canJoinTournament,
  validateTournamentPolicy,
} from '../src/community/tournaments.js';
describe('tournament policy boundary', () => {
  it('keeps entrant capacity bounded', () => {
    const policy = validateTournamentPolicy({
      serverId: '12345678',
      enabled: true,
      maxEntrants: 16,
      format: 'single_elimination',
    });
    expect(canJoinTournament(policy, 15)).toBe(true);
    expect(canJoinTournament(policy, 16)).toBe(false);
  });
  it('rejects unsafe capacity', () => {
    expect(() =>
      validateTournamentPolicy({
        serverId: '12345678',
        enabled: true,
        maxEntrants: 1,
        format: 'round_robin',
      }),
    ).toThrow();
  });
});
