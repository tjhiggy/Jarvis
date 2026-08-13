import { describe, expect, it } from 'vitest';
import { isRestHostAllowed, validateRestRequestPolicy } from '../src/providers/rest-boundary.js';
describe('read-only REST boundary', () => {
  it('allows only bounded configured hosts and safe methods', () => {
    const policy = validateRestRequestPolicy({ allowedHosts: ['api.example.com'], timeoutMs: 5000, maxBytes: 100000, allowMethods: ['GET'] });
    expect(isRestHostAllowed(policy, 'api.example.com')).toBe(true);
    expect(isRestHostAllowed(policy, 'evil.example.com')).toBe(false);
  });
  it('rejects unsafe transport policy', () => {
    expect(() => validateRestRequestPolicy({ allowedHosts: ['*'], timeoutMs: 5000, maxBytes: 100000, allowMethods: ['POST'] as never })).toThrow();
  });
});
