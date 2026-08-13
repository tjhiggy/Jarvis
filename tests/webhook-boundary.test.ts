import { describe, expect, it } from 'vitest';
import { isWebhookHostAllowed, validateWebhookPolicy } from '../src/providers/webhook-boundary.js';
describe('webhook boundary', () => {
  it('requires explicit destinations and signatures', () => {
    const policy = validateWebhookPolicy({ allowedHosts: ['hooks.example.com'], timeoutMs: 5000, maxBytes: 100000, requireSignature: true });
    expect(policy.requireSignature).toBe(true);
    expect(isWebhookHostAllowed(policy, 'hooks.example.com')).toBe(true);
  });
  it('rejects open or unbounded policy', () => {
    expect(() => validateWebhookPolicy({ allowedHosts: [], timeoutMs: 5000, maxBytes: 100000, requireSignature: false })).toThrow();
  });
});
