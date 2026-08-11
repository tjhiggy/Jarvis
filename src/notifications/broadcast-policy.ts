import type { BroadcastStore } from './broadcast-store.js';

export type BroadcastCategory =
  'rss' | 'proactive' | 'recap' | 'event_reminder' | 'birthday';

export type BroadcastDecision =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason:
        | 'disabled'
        | 'paused'
        | 'globally_paused'
        | 'destination_not_allowed'
        | 'quiet_hours'
        | 'cadence_limited'
        | 'member_not_opted_in';
    };

export interface BroadcastPolicyEvaluationInput {
  readonly serverId: string;
  readonly category: BroadcastCategory;
  readonly channelId: string;
  readonly now: Date;
  readonly globallyPaused?: boolean;
  readonly userId?: string;
}

export const memberControllable = (category: BroadcastCategory): boolean =>
  category === 'event_reminder' || category === 'birthday';

export class BroadcastPolicyService {
  private readonly allowedChannelIds: ReadonlySet<string>;

  constructor(
    private readonly store: BroadcastStore,
    allowedChannelIds: readonly string[],
  ) {
    this.allowedChannelIds = new Set(allowedChannelIds);
  }

  async evaluate(
    input: BroadcastPolicyEvaluationInput,
  ): Promise<BroadcastDecision> {
    if (!this.allowedChannelIds.has(input.channelId)) {
      return { allowed: false, reason: 'destination_not_allowed' };
    }
    if (input.globallyPaused) {
      return { allowed: false, reason: 'globally_paused' };
    }

    const policy = await this.store.getPolicy(input.serverId, input.category);
    if (policy === undefined || policy.state === 'disabled') {
      return { allowed: false, reason: 'disabled' };
    }
    if (policy.state === 'paused') {
      return { allowed: false, reason: 'paused' };
    }
    if (policy.channelId !== input.channelId) {
      return { allowed: false, reason: 'destination_not_allowed' };
    }
    if (
      isQuietHour(
        policy.timezone,
        policy.quietStartMinute,
        policy.quietEndMinute,
        input.now,
      )
    ) {
      return { allowed: false, reason: 'quiet_hours' };
    }
    const latestCompletedAt = await this.store.getLatestCompletedAt(
      input.serverId,
      input.category,
    );
    if (
      isCadenceLimited(
        policy.minimumIntervalSeconds,
        latestCompletedAt,
        input.now,
      )
    ) {
      return { allowed: false, reason: 'cadence_limited' };
    }
    if (memberControllable(input.category)) {
      if (input.userId === undefined) {
        return { allowed: false, reason: 'member_not_opted_in' };
      }
      const preference = await this.store.getMemberPreference(
        input.serverId,
        input.userId,
        input.category,
      );
      if (preference?.enabled !== true) {
        return { allowed: false, reason: 'member_not_opted_in' };
      }
    }

    return { allowed: true };
  }
}

function isQuietHour(
  timezone: string,
  quietStartMinute: number | undefined,
  quietEndMinute: number | undefined,
  now: Date,
): boolean {
  if (quietStartMinute === undefined || quietEndMinute === undefined) {
    return false;
  }
  if (quietStartMinute === quietEndMinute) return false;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  const currentMinute = hour * 60 + minute;

  return quietStartMinute < quietEndMinute
    ? currentMinute >= quietStartMinute && currentMinute < quietEndMinute
    : currentMinute >= quietStartMinute || currentMinute < quietEndMinute;
}

function isCadenceLimited(
  minimumIntervalSeconds: number,
  lastCompletedAt: Date | undefined,
  now: Date,
): boolean {
  if (lastCompletedAt === undefined || minimumIntervalSeconds === 0) {
    return false;
  }
  return (
    now.getTime() - lastCompletedAt.getTime() < minimumIntervalSeconds * 1000
  );
}
