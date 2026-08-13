export type AutoModRuleKind = 'spam' | 'flood' | 'link' | 'prohibited_content';
export interface AutoModRule { readonly kind: AutoModRuleKind; readonly enabled: boolean; readonly threshold: number; }
export interface AutoModPolicy { readonly serverId: string; readonly enabled: boolean; readonly rules: readonly AutoModRule[]; }
const id = /^[0-9]{8,20}$/;
export function validateAutoModPolicy(policy: AutoModPolicy): AutoModPolicy {
  if (!id.test(policy.serverId)) throw new Error('invalid server id');
  if (policy.rules.length > 8) throw new Error('too many AutoMod rules');
  const seen = new Set<AutoModRuleKind>();
  for (const rule of policy.rules) { if (seen.has(rule.kind)) throw new Error('duplicate AutoMod rule'); if (!Number.isInteger(rule.threshold) || rule.threshold < 1 || rule.threshold > 100) throw new Error('invalid AutoMod threshold'); seen.add(rule.kind); }
  return Object.freeze({ serverId: policy.serverId, enabled: policy.enabled, rules: Object.freeze([...policy.rules]) });
}
export function evaluateAutoMod(policy: AutoModPolicy, input: { readonly kind: AutoModRuleKind; readonly count: number }): 'allow' | 'flag' {
  if (!policy.enabled) return 'allow'; const rule = policy.rules.find((candidate) => candidate.kind === input.kind); return rule !== undefined && rule.enabled && input.count >= rule.threshold ? 'flag' : 'allow';
}
