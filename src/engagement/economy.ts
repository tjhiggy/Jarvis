export interface EconomyStore {
  balance(serverId: string, userId: string): Promise<number>;
  award(
    serverId: string,
    userId: string,
    amount: number,
    key: string,
    at: Date,
  ): Promise<boolean>;
  optedOut(serverId: string, userId: string): Promise<boolean>;
}
export class EconomyService {
  constructor(private readonly store: EconomyStore) {}
  async balance(serverId: string, userId: string) {
    return this.store.balance(serverId, userId);
  }
  async award(
    serverId: string,
    userId: string,
    amount: number,
    key: string,
    at = new Date(),
  ) {
    if (amount <= 0 || amount > 100)
      throw new RangeError('Award must be between 1 and 100 coins.');
    if (await this.store.optedOut(serverId, userId)) return false;
    return this.store.award(serverId, userId, amount, key, at);
  }
}
