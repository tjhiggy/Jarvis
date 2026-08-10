import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SQLiteTeamStore } from '../src/engagement/teams.js';

const store = () => new SQLiteTeamStore(join(mkdtempSync(join(tmpdir(), 'jarvis-team-')), 'teams.db'));

describe('persistent teams', () => {
  it('creates, lists, joins, and leaves within a server boundary', async () => {
    const s = store();
    const team = await s.create('server-a', 'Raid Crew', 'u1');
    expect(team.memberCount).toBe(1);
    await s.join('server-a', team.id, 'u2');
    expect((await s.list('server-a'))[0]?.memberCount).toBe(2);
    expect(await s.leave('server-a', team.id, 'u2')).toBe(true);
    expect((await s.list('server-a'))[0]?.memberCount).toBe(1);
    await s.close();
  });

  it('does not cross server boundaries and enforces duplicate names', async () => {
    const s = store();
    await s.create('server-a', 'Crew', 'u1');
    await expect(s.create('server-a', ' Crew ', 'u2')).rejects.toThrow(/already exists/i);
    expect(await s.list('server-b')).toEqual([]);
    await expect(s.join('server-b', 'missing', 'u2')).rejects.toThrow(/not found/i);
    await s.close();
  });

  it('persists across store instances', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'jarvis-team-')), 'teams.db');
    const first = new SQLiteTeamStore(path);
    await first.create('server-a', 'Persisted', 'u1');
    await first.close();
    const second = new SQLiteTeamStore(path);
    expect((await second.list('server-a'))[0]?.name).toBe('Persisted');
    await second.close();
  });
});
