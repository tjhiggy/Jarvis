import { describe, expect, it } from 'vitest';
import { TeamService } from '../src/engagement/teams.js';
describe('persistent teams foundation', () => {
  it('normalizes names and delegates membership operations', async () => {
    const calls: string[] = [];
    const service = new TeamService({
      create: async (_s, n, o) => {
        calls.push(`create:${n}`);
        return {
          id: '1',
          serverId: 's',
          name: n,
          ownerId: o,
          memberIds: [o],
          createdAt: new Date(),
        };
      },
      list: async () => [],
      join: async (_s, n) => {
        calls.push(`join:${n}`);
        return 'joined';
      },
      leave: async () => 'left',
    });
    expect((await service.create('s', '  Crew  ', 'u'))?.name).toBe('Crew');
    expect(await service.join('s', ' Crew ', 'u2')).toBe('joined');
    expect(calls).toEqual(['create:Crew', 'join:Crew']);
  });
});
