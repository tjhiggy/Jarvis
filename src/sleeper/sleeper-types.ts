export interface SleeperStanding {
  readonly rosterId: number;
  readonly ownerId: string;
  readonly wins: number;
  readonly losses: number;
  readonly ties: number;
  readonly pointsFor: number;
  readonly pointsAgainst: number;
  readonly ownerName?: string;
}

export interface SleeperService {
  getStandings(leagueId: string): Promise<readonly SleeperStanding[]>;
}

export class SleeperServiceError extends Error {
  readonly kind: 'unavailable' | 'invalid-data' | 'rate-limited';

  constructor(kind: SleeperServiceError['kind'], message: string) {
    super(message);
    this.name = 'SleeperServiceError';
    this.kind = kind;
  }
}
