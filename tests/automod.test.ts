import { describe, expect, it } from 'vitest';
import { evaluateAutoMod, validateAutoModPolicy } from '../src/moderation/automod.js';
describe('AutoMod policy boundary', () => {
  it('validates bounded rules and flags configured thresholds', () => { const policy = validateAutoModPolicy({ serverId: '12345678', enabled: true, rules: [{ kind: 'spam', enabled: true, threshold: 3 }] }); expect(evaluateAutoMod(policy, { kind: 'spam', count: 2 })).toBe('allow'); expect(evaluateAutoMod(policy, { kind: 'spam', count: 3 })).toBe('flag'); });
  it('fails duplicate and unbounded rules', () => { expect(() => validateAutoModPolicy({ serverId: '12345678', enabled: true, rules: [{ kind: 'spam', enabled: true, threshold: 1 }, { kind: 'spam', enabled: true, threshold: 2 }] })).toThrow(); expect(() => validateAutoModPolicy({ serverId: '12345678', enabled: true, rules: [{ kind: 'flood', enabled: true, threshold: 101 }] })).toThrow(); });
});
