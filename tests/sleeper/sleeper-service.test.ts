import { describe, expect, it, vi } from 'vitest';
import { HttpSleeperService } from '../../src/sleeper/sleeper-service.js';
import { SleeperServiceError } from '../../src/sleeper/sleeper-types.js';

describe('HttpSleeperService', () => {
  it('retrieves validated roster standings', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ roster_id: 1, owner_id: 'u1' }]), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ user_id: 'u1', display_name: 'Captain Jim' }]),
          { status: 200 },
        ),
      );
    const result = await new HttpSleeperService({ fetch }).getStandings(
      '123456789',
    );
    expect(result[0]).toMatchObject({
      rosterId: 1,
      ownerId: 'u1',
      ownerName: 'Captain Jim',
    });
  });

  it('accepts unassigned pre-draft rosters', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ roster_id: 1, owner_id: null }]), {
        status: 200,
      }),
    );
    const result = await new HttpSleeperService({ fetch }).getStandings(
      '123456789',
    );
    expect(result[0]).toMatchObject({ rosterId: 1, ownerId: 'unassigned' });
  });

  it('maps rate limits', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
    await expect(
      new HttpSleeperService({ fetch }).getStandings('123456789'),
    ).rejects.toMatchObject({ kind: 'rate-limited' });
  });

  it('rejects malformed league IDs before making a request', async () => {
    const fetch = vi.fn();
    await expect(
      new HttpSleeperService({ fetch }).getStandings('not-a-league'),
    ).rejects.toBeInstanceOf(SleeperServiceError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retrieves validated weekly matchups and maps owner names', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { roster_id: 1, matchup_id: 7, points: 112.5 },
            { roster_id: 2, matchup_id: 7, points: 98.25 },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { roster_id: 1, owner_id: 'u1' },
            { roster_id: 2, owner_id: 'u2' },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ user_id: 'u1', display_name: 'Captain Jim' }]),
          { status: 200 },
        ),
      );
    const result = await new HttpSleeperService({ fetch }).getMatchups(
      '123456789',
      3,
    );
    expect(result).toEqual([
      {
        rosterId: 1,
        matchupId: 7,
        points: 112.5,
        ownerId: 'u1',
        ownerName: 'Captain Jim',
      },
      { rosterId: 2, matchupId: 7, points: 98.25, ownerId: 'u2' },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/league/123456789/matchups/3'),
      expect.anything(),
    );
  });

  it('returns safe unassigned matchups before the draft', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ roster_id: 1, matchup_id: null }]), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response('[]', { status: 200 }))
      .mockResolvedValueOnce(new Response('[]', { status: 200 }));
    const result = await new HttpSleeperService({ fetch }).getMatchups(
      '123456789',
      1,
    );
    expect(result[0]).toMatchObject({
      rosterId: 1,
      matchupId: null,
      ownerId: 'unassigned',
      points: 0,
    });
  });

  it('rejects invalid matchup weeks before making a request', async () => {
    const fetch = vi.fn();
    await expect(
      new HttpSleeperService({ fetch }).getMatchups('123456789', 0),
    ).rejects.toMatchObject({ kind: 'invalid-data' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retrieves bounded player statistics for a season and week', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ pass_yd: 245.5, pass_td: 2, ignored: 'text' }),
          { status: 200 },
        ),
      );
    const result = await new HttpSleeperService({ fetch }).getPlayerStats(
      'abc123',
      2026,
      3,
    );
    expect(result).toEqual({
      playerId: 'abc123',
      season: 2026,
      week: 3,
      stats: { pass_yd: 245.5, pass_td: 2 },
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/stats/nfl/2026/3?player_id=abc123'),
      expect.anything(),
    );
  });

  it('maps player-stat rate limits and rejects invalid identifiers locally', async () => {
    const rateLimited = vi
      .fn()
      .mockResolvedValue(new Response('', { status: 429 }));
    await expect(
      new HttpSleeperService({ fetch: rateLimited }).getPlayerStats(
        'abc123',
        2026,
      ),
    ).rejects.toMatchObject({ kind: 'rate-limited' });
    const invalid = vi.fn();
    await expect(
      new HttpSleeperService({ fetch: invalid }).getPlayerStats(
        'not allowed',
        2026,
      ),
    ).rejects.toMatchObject({ kind: 'invalid-data' });
    expect(invalid).not.toHaveBeenCalled();
  });
});
