import { describe, expect, it, vi } from 'vitest';
import { HttpSleeperService } from '../../src/sleeper/sleeper-service.js';
import { SleeperServiceError } from '../../src/sleeper/sleeper-types.js';

describe('HttpSleeperService', () => {
  it('retrieves validated roster standings', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ roster_id: 1, owner_id: 'u1' }]), { status: 200 }));
    const result = await new HttpSleeperService({ fetch }).getStandings('123456789');
    expect(result[0]).toMatchObject({ rosterId: 1, ownerId: 'u1' });
  });

  it('accepts unassigned pre-draft rosters', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ roster_id: 1, owner_id: null }]), { status: 200 }));
    const result = await new HttpSleeperService({ fetch }).getStandings('123456789');
    expect(result[0]).toMatchObject({ rosterId: 1, ownerId: 'unassigned' });
  });

  it('maps rate limits', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
    await expect(new HttpSleeperService({ fetch }).getStandings('123456789')).rejects.toMatchObject({ kind: 'rate-limited' });
  });

  it('rejects malformed league IDs before making a request', async () => {
    const fetch = vi.fn();
    await expect(new HttpSleeperService({ fetch }).getStandings('not-a-league')).rejects.toBeInstanceOf(SleeperServiceError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
