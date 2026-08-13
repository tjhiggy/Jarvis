export interface RestRequestPolicy { readonly allowedHosts: readonly string[]; readonly timeoutMs: number; readonly maxBytes: number; readonly allowMethods: readonly ('GET' | 'HEAD')[]; }
export function validateRestRequestPolicy(policy: RestRequestPolicy): RestRequestPolicy {
  if (policy.allowedHosts.length > 20 || policy.allowedHosts.some((host) => !/^[a-z0-9.-]+$/i.test(host) || host.includes('..'))) throw new Error('invalid REST host allowlist');
  if (!Number.isInteger(policy.timeoutMs) || policy.timeoutMs < 100 || policy.timeoutMs > 30000) throw new Error('invalid REST timeout');
  if (!Number.isInteger(policy.maxBytes) || policy.maxBytes < 1024 || policy.maxBytes > 5_000_000) throw new Error('invalid REST response limit');
  if (policy.allowMethods.some((method) => method !== 'GET' && method !== 'HEAD')) throw new Error('unsupported REST method');
  return Object.freeze({ ...policy, allowedHosts: Object.freeze([...policy.allowedHosts]), allowMethods: Object.freeze([...policy.allowMethods]) });
}
export function isRestHostAllowed(policy: RestRequestPolicy, hostname: string): boolean { return policy.allowedHosts.includes(hostname.toLowerCase()); }
