export interface WebhookPolicy { readonly allowedHosts: readonly string[]; readonly timeoutMs: number; readonly maxBytes: number; readonly requireSignature: boolean; }
export function validateWebhookPolicy(policy: WebhookPolicy): WebhookPolicy {
  if (!policy.allowedHosts.length || policy.allowedHosts.length > 20 || policy.allowedHosts.some((host) => !/^[a-z0-9.-]+$/i.test(host) || host.includes('..'))) throw new Error('invalid webhook host allowlist');
  if (!Number.isInteger(policy.timeoutMs) || policy.timeoutMs < 100 || policy.timeoutMs > 30000) throw new Error('invalid webhook timeout');
  if (!Number.isInteger(policy.maxBytes) || policy.maxBytes < 1024 || policy.maxBytes > 1_000_000) throw new Error('invalid webhook payload limit');
  return Object.freeze({ ...policy, allowedHosts: Object.freeze([...policy.allowedHosts]) });
}
export function isWebhookHostAllowed(policy: WebhookPolicy, hostname: string): boolean { return policy.allowedHosts.includes(hostname.toLowerCase()); }
