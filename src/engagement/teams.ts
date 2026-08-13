export interface Team {
  readonly id: string;
  readonly serverId: string;
  readonly name: string;
  readonly ownerId: string;
  readonly memberIds: readonly string[];
  readonly createdAt: Date;
}
export interface TeamStore {
  create(
    serverId: string,
    name: string,
    ownerId: string,
    at: Date,
  ): Promise<Team | undefined>;
  list(serverId: string): Promise<readonly Team[]>;
  join(
    serverId: string,
    name: string,
    userId: string,
  ): Promise<'joined' | 'already' | 'full' | 'missing'>;
  leave(
    serverId: string,
    name: string,
    userId: string,
  ): Promise<'left' | 'absent' | 'missing'>;
}
const clean = (name: string) => {
  const value = name.trim().replace(/\s+/g, ' ');
  if (value.length < 2 || value.length > 40)
    throw new RangeError('Team name must be 2-40 characters.');
  return value;
};
export class TeamService {
  constructor(private readonly store: TeamStore) {}
  create(serverId: string, name: string, ownerId: string, at = new Date()) {
    return this.store.create(serverId, clean(name), ownerId, at);
  }
  list(serverId: string) {
    return this.store.list(serverId);
  }
  join(serverId: string, name: string, userId: string) {
    return this.store.join(serverId, clean(name), userId);
  }
  leave(serverId: string, name: string, userId: string) {
    return this.store.leave(serverId, clean(name), userId);
  }
}
