import { SleeperServiceError, type SleeperService, type SleeperStanding } from './sleeper-types.js';

const apiBaseUrl = 'https://api.sleeper.app/v1';

export interface SleeperHttpClient {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}

export class HttpSleeperService implements SleeperService {
  private readonly http: SleeperHttpClient;
  private readonly timeoutMs: number;

  constructor(http: SleeperHttpClient = globalThis, timeoutMs = 10_000) {
    this.http = http;
    this.timeoutMs = timeoutMs;
  }

  async getStandings(leagueId: string): Promise<readonly SleeperStanding[]> {
    if (!/^\d{8,20}$/.test(leagueId.trim())) {
      throw new SleeperServiceError('invalid-data', 'Invalid Sleeper league ID.');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.http.fetch(
        `${apiBaseUrl}/league/${encodeURIComponent(leagueId)}/rosters`,
        { signal: controller.signal },
      );
      if (response.status === 429) throw new SleeperServiceError('rate-limited', 'Sleeper rate limit reached.');
      if (!response.ok) throw new SleeperServiceError('unavailable', 'Sleeper is unavailable.');
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) throw new SleeperServiceError('invalid-data', 'Sleeper returned invalid standings data.');
      const standings = payload.map(parseStanding);
      const names = await this.getOwnerNames(leagueId, controller.signal);
      return standings.map((standing) => {
        const ownerName = names.get(standing.ownerId);
        return ownerName === undefined ? standing : { ...standing, ownerName };
      });
    } catch (error) {
      if (error instanceof SleeperServiceError) throw error;
      throw new SleeperServiceError('unavailable', 'Sleeper is unavailable.');
    } finally {
      clearTimeout(timer);
    }
  }

  private async getOwnerNames(leagueId: string, signal: AbortSignal): Promise<ReadonlyMap<string, string>> {
    try {
      const response = await this.http.fetch(`${apiBaseUrl}/league/${encodeURIComponent(leagueId)}/users`, { signal });
      if (!response.ok) return new Map();
      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) return new Map();
      const names = new Map<string, string>();
      for (const value of payload) {
        if (typeof value !== 'object' || value === null) continue;
        const item = value as Record<string, unknown>;
        if (typeof item.user_id === 'string' && typeof item.display_name === 'string' && item.display_name.trim() !== '') {
          names.set(item.user_id, item.display_name.trim());
        }
      }
      return names;
    } catch {
      return new Map();
    }
  }
}

const parseStanding = (value: unknown): SleeperStanding => {
  if (typeof value !== 'object' || value === null) throw new SleeperServiceError('invalid-data', 'Sleeper returned invalid standings data.');
  const item = value as Record<string, unknown>;
  const settings = typeof item.settings === 'object' && item.settings !== null ? item.settings as Record<string, unknown> : {};
  const number = (key: string): number => typeof settings[key] === 'number' && Number.isFinite(settings[key]) ? settings[key] as number : 0;
  if (typeof item.roster_id !== 'number' || (item.owner_id !== null && typeof item.owner_id !== 'string')) {
    throw new SleeperServiceError('invalid-data', 'Sleeper returned invalid standings data.');
  }
  return {
    rosterId: item.roster_id,
    ownerId: item.owner_id ?? 'unassigned',
    wins: number('wins'),
    losses: number('losses'),
    ties: number('ties'),
    pointsFor: number('fpts'),
    pointsAgainst: number('fpts_against'),
  };
};
