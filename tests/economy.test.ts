import { describe, expect, it } from 'vitest';
import { EconomyService } from '../src/engagement/economy.js';
describe('economy foundation', () => {
  it('is idempotent and honors opt-out', async () => {
    const keys = new Set<string>();
    let total = 0;
    const service = new EconomyService({
      balance: async () => total,
      optedOut: async () => false,
      award: async (_s, _u, a, k) => {
        if (keys.has(k)) return false;
        keys.add(k);
        total += a;
        return true;
      },
    });
    expect(await service.award('s', 'u', 10, 'daily:1')).toBe(true);
    expect(await service.award('s', 'u', 10, 'daily:1')).toBe(false);
    expect(await service.balance('s', 'u')).toBe(10);
  });
});
