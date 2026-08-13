export interface TournamentPolicy {
  readonly serverId: string;
  readonly enabled: boolean;
  readonly maxEntrants: number;
  readonly format: 'single_elimination' | 'round_robin';
}
const id = /^[0-9]{8,20}$/;
export function validateTournamentPolicy(
  policy: TournamentPolicy,
): TournamentPolicy {
  if (!id.test(policy.serverId))
    throw new Error('invalid tournament server id');
  if (
    !Number.isInteger(policy.maxEntrants) ||
    policy.maxEntrants < 2 ||
    policy.maxEntrants > 256
  )
    throw new Error('invalid tournament entrant limit');
  return Object.freeze({ ...policy });
}
export function canJoinTournament(
  policy: TournamentPolicy,
  entrants: number,
): boolean {
  return (
    policy.enabled &&
    Number.isInteger(entrants) &&
    entrants >= 0 &&
    entrants < policy.maxEntrants
  );
}
