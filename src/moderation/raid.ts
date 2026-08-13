export interface RaidPolicy {
  readonly serverId: string;
  readonly enabled: boolean;
  readonly joinWindowSeconds: number;
  readonly joinThreshold: number;
  readonly action: 'flag' | 'pause_recommendation';
}
export interface RaidSignal {
  readonly serverId: string;
  readonly joins: number;
  readonly windowSeconds: number;
}
const id = /^[0-9]{8,20}$/;
export function validateRaidPolicy(policy: RaidPolicy): RaidPolicy {
  if (!id.test(policy.serverId))
    throw new Error('invalid raid policy server id');
  if (
    !Number.isInteger(policy.joinWindowSeconds) ||
    policy.joinWindowSeconds < 10 ||
    policy.joinWindowSeconds > 3600
  )
    throw new Error('invalid raid join window');
  if (
    !Number.isInteger(policy.joinThreshold) ||
    policy.joinThreshold < 2 ||
    policy.joinThreshold > 10000
  )
    throw new Error('invalid raid join threshold');
  return Object.freeze({ ...policy });
}
export function evaluateRaidPolicy(
  policy: RaidPolicy,
  signal: RaidSignal,
): 'allow' | 'flag' | 'pause_recommendation' {
  if (
    !policy.enabled ||
    signal.serverId !== policy.serverId ||
    signal.windowSeconds !== policy.joinWindowSeconds ||
    signal.joins < policy.joinThreshold
  )
    return 'allow';
  return policy.action;
}
