import { describe, expect, it } from 'vitest';
import {
  BroadcastPolicyService,
  memberControllable,
  type BroadcastCategory,
} from '../src/notifications/broadcast-policy.js';
import type {
  BroadcastDeliveryHealth,
  BroadcastMemberPreference,
  BroadcastPolicy,
  BroadcastStore,
} from '../src/notifications/broadcast-store.js';

describe('BroadcastPolicyService', () => {
  it('rejects a destination outside the environment allowlist', async () => {
    const service = new BroadcastPolicyService(new InMemoryBroadcastStore(), [
      'allowed',
    ]);

    await expect(
      service.evaluate({
        serverId: 'server',
        category: 'rss',
        channelId: 'other',
        now: new Date('2026-08-11T12:00:00-04:00'),
      }),
    ).resolves.toEqual({ allowed: false, reason: 'destination_not_allowed' });
  });

  it('does not pretend a member can disable a public-only category', () => {
    expect(memberControllable('rss')).toBe(false);
    expect(memberControllable('event_reminder')).toBe(true);
  });

  it('enforces the global pause before an enabled policy may deliver', async () => {
    const store = new InMemoryBroadcastStore(policy());
    const service = new BroadcastPolicyService(store, ['allowed']);

    await expect(
      service.evaluate({
        serverId: 'server',
        category: 'rss',
        channelId: 'allowed',
        now: new Date('2026-08-11T12:00:00-04:00'),
        globallyPaused: true,
      }),
    ).resolves.toEqual({ allowed: false, reason: 'globally_paused' });
  });

  it('requires an enabled policy for the configured server and category', async () => {
    const service = new BroadcastPolicyService(new InMemoryBroadcastStore(), [
      'allowed',
    ]);

    await expect(
      service.evaluate({
        serverId: 'server',
        category: 'rss',
        channelId: 'allowed',
        now: new Date('2026-08-11T12:00:00-04:00'),
      }),
    ).resolves.toEqual({ allowed: false, reason: 'disabled' });
  });

  it.each([
    ['disabled', 'disabled'],
    ['paused', 'paused'],
  ] as const)(
    'returns %s for a policy in that state',
    async (state, reason) => {
      const service = new BroadcastPolicyService(
        new InMemoryBroadcastStore(policy({ state })),
        ['allowed'],
      );

      await expect(
        service.evaluate({
          serverId: 'server',
          category: 'rss',
          channelId: 'allowed',
          now: new Date('2026-08-11T12:00:00-04:00'),
        }),
      ).resolves.toEqual({ allowed: false, reason });
    },
  );

  it('rejects an allowlisted channel that does not match the policy destination', async () => {
    const service = new BroadcastPolicyService(
      new InMemoryBroadcastStore(policy({ channelId: 'configured' })),
      ['allowed', 'configured'],
    );

    await expect(
      service.evaluate({
        serverId: 'server',
        category: 'rss',
        channelId: 'allowed',
        now: new Date('2026-08-11T12:00:00-04:00'),
      }),
    ).resolves.toEqual({ allowed: false, reason: 'destination_not_allowed' });
  });

  it('rejects deliveries inside the configured quiet-hours window', async () => {
    const service = new BroadcastPolicyService(
      new InMemoryBroadcastStore(
        policy({ quietStartMinute: 22 * 60, quietEndMinute: 7 * 60 }),
      ),
      ['allowed'],
    );

    await expect(
      service.evaluate({
        serverId: 'server',
        category: 'rss',
        channelId: 'allowed',
        now: new Date('2026-08-11T22:30:00-04:00'),
      }),
    ).resolves.toEqual({ allowed: false, reason: 'quiet_hours' });
  });

  it('enforces minimum delivery cadence from the most recent completion', async () => {
    const service = new BroadcastPolicyService(
      new InMemoryBroadcastStore(
        policy({ minimumIntervalSeconds: 600 }),
        new Date('2026-08-11T12:00:00-04:00'),
      ),
      ['allowed'],
    );

    await expect(
      service.evaluate({
        serverId: 'server',
        category: 'rss',
        channelId: 'allowed',
        now: new Date('2026-08-11T12:05:00-04:00'),
      }),
    ).resolves.toEqual({ allowed: false, reason: 'cadence_limited' });
  });

  it('requires an explicit preference for a personally targeted category', async () => {
    const store = new InMemoryBroadcastStore(policy({ category: 'birthday' }));
    const service = new BroadcastPolicyService(store, ['allowed']);

    await expect(
      service.evaluate({
        serverId: 'server',
        category: 'birthday',
        channelId: 'allowed',
        userId: 'crew-member',
        now: new Date('2026-08-11T12:00:00-04:00'),
      }),
    ).resolves.toEqual({ allowed: false, reason: 'member_not_opted_in' });

    await store.setMemberPreference({
      serverId: 'server',
      userId: 'crew-member',
      category: 'birthday',
      enabled: true,
      updatedAt: new Date('2026-08-11T12:00:00-04:00'),
    });

    await expect(
      service.evaluate({
        serverId: 'server',
        category: 'birthday',
        channelId: 'allowed',
        userId: 'crew-member',
        now: new Date('2026-08-11T12:00:00-04:00'),
      }),
    ).resolves.toEqual({ allowed: true });
  });
});

class InMemoryBroadcastStore implements BroadcastStore {
  private storedPolicy: BroadcastPolicy | undefined;
  private readonly preferences = new Map<string, BroadcastMemberPreference>();

  constructor(
    policy?: BroadcastPolicy,
    private readonly latestCompletedAt?: Date,
  ) {
    this.storedPolicy = policy;
  }

  async getPolicy(
    serverId: string,
    category: BroadcastCategory,
  ): Promise<BroadcastPolicy | undefined> {
    if (
      this.storedPolicy?.serverId === serverId &&
      this.storedPolicy.category === category
    ) {
      return this.storedPolicy;
    }
    return undefined;
  }

  async setPolicy(policyValue: BroadcastPolicy): Promise<void> {
    this.storedPolicy = policyValue;
  }

  async getMemberPreference(
    serverId: string,
    userId: string,
    category: BroadcastCategory,
  ): Promise<BroadcastMemberPreference | undefined> {
    return this.preferences.get(`${serverId}:${userId}:${category}`);
  }

  async setMemberPreference(
    preference: BroadcastMemberPreference,
  ): Promise<void> {
    this.preferences.set(
      `${preference.serverId}:${preference.userId}:${preference.category}`,
      preference,
    );
  }

  async claimDelivery(): Promise<string | undefined> {
    return undefined;
  }

  async completeDelivery(): Promise<boolean> {
    return false;
  }

  async releaseDelivery(): Promise<boolean> {
    return false;
  }

  async deliveryHealth(): Promise<BroadcastDeliveryHealth | undefined> {
    return undefined;
  }

  async cleanup(): Promise<number> {
    return 0;
  }

  async getLatestCompletedAt(): Promise<Date | undefined> {
    return this.latestCompletedAt;
  }
}

function policy(overrides: Partial<BroadcastPolicy> = {}): BroadcastPolicy {
  return {
    serverId: 'server',
    category: 'rss',
    state: 'enabled',
    channelId: 'allowed',
    timezone: 'America/New_York',
    minimumIntervalSeconds: 0,
    digestMode: false,
    updatedAt: new Date('2026-08-11T12:00:00-04:00'),
    ...overrides,
  };
}
