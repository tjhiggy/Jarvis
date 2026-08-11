import type { BroadcastCategory } from './broadcast-policy.js';

export type BroadcastPolicyState = 'enabled' | 'paused' | 'disabled';

export interface BroadcastPolicy {
  readonly serverId: string;
  readonly category: BroadcastCategory;
  readonly state: BroadcastPolicyState;
  readonly channelId: string;
  readonly timezone: string;
  readonly quietStartMinute?: number;
  readonly quietEndMinute?: number;
  readonly minimumIntervalSeconds: number;
  readonly digestMode: boolean;
  readonly updatedAt: Date;
  readonly updatedByUserId?: string;
}

export interface BroadcastMemberPreference {
  readonly serverId: string;
  readonly userId: string;
  readonly category: BroadcastCategory;
  readonly enabled: boolean;
  readonly updatedAt: Date;
}

export type BroadcastDeliveryStatus = 'pending' | 'claimed' | 'completed';

export type BroadcastDeliveryErrorCategory =
  'network' | 'permission' | 'rate_limit' | 'service';

export interface BroadcastDeliveryHealth {
  readonly status: BroadcastDeliveryStatus;
  readonly claimedAt?: Date;
  readonly completedAt?: Date;
  readonly errorCategory?: BroadcastDeliveryErrorCategory;
}

export interface BroadcastStore {
  getPolicy(
    serverId: string,
    category: BroadcastCategory,
  ): Promise<BroadcastPolicy | undefined>;
  setPolicy(policy: BroadcastPolicy): Promise<void>;
  getMemberPreference(
    serverId: string,
    userId: string,
    category: BroadcastCategory,
  ): Promise<BroadcastMemberPreference | undefined>;
  setMemberPreference(preference: BroadcastMemberPreference): Promise<void>;
  claimDelivery(
    serverId: string,
    category: BroadcastCategory,
    deliveryKey: string,
    now: Date,
  ): Promise<string | undefined>;
  completeDelivery(
    serverId: string,
    category: BroadcastCategory,
    deliveryKey: string,
    leaseToken: string,
    now: Date,
  ): Promise<boolean>;
  releaseDelivery(
    serverId: string,
    category: BroadcastCategory,
    deliveryKey: string,
    leaseToken: string,
    now: Date,
    errorCategory?: BroadcastDeliveryErrorCategory,
  ): Promise<boolean>;
  deliveryHealth(
    serverId: string,
    category: BroadcastCategory,
    deliveryKey: string,
  ): Promise<BroadcastDeliveryHealth | undefined>;
  latestDeliveryHealth(
    serverId: string,
    category: BroadcastCategory,
  ): Promise<BroadcastDeliveryHealth | undefined>;
  getLatestCompletedAt(
    serverId: string,
    category: BroadcastCategory,
  ): Promise<Date | undefined>;
  cleanup(cutoff: Date, limit: number): Promise<number>;
}
