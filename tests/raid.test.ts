import { describe, expect, it } from 'vitest';
import { evaluateRaidPolicy, validateRaidPolicy } from '../src/moderation/raid.js';
describe('raid policy boundary', () => {
  it('flags bounded join spikes without mutating Discord', () => {
    const policy = validateRaidPolicy({ serverId: '12345678', enabled: true, joinWindowSeconds: 60, joinThreshold: 10, action: 'pause_recommendation' });
    expect(evaluateRaidPolicy(policy, { serverId: '12345678', joins: 9, windowSeconds: 60 })).toBe('allow');
    expect(evaluateRaidPolicy(policy, { serverId: '12345678', joins: 10, windowSeconds: 60 })).toBe('pause_recommendation');
  });
  it('rejects unsafe policy bounds', () => {
    expect(() => validateRaidPolicy({ serverId: '12345678', enabled: true, joinWindowSeconds: 1, joinThreshold: 10, action: 'flag' })).toThrow();
  });
});
