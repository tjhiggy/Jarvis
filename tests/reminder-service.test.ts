import { describe, expect, it } from 'vitest';

import {
  ReminderService,
  ReminderServiceError,
} from '../src/reminders/reminder-service.js';
import {
  ReminderActiveLimitError,
  type CreateReminderInput,
  type ReminderStore,
} from '../src/reminders/reminder-store.js';
import type { ReminderView } from '../src/reminders/reminder-types.js';

const now = new Date('2026-07-29T12:00:00.000Z');

describe('ReminderService', () => {
  it('trims, validates, rate-limits, and stores a personal reminder', async () => {
    const store = new InMemoryReminderStore();
    const consumedKeys: string[] = [];
    const service = new ReminderService({
      store,
      rateLimiter: {
        consume: (key) => {
          consumedKeys.push(key);
          return { allowed: true, retryAfterMs: 0 };
        },
      },
      now: () => now,
      createId: () => 'abcdef234567',
    });

    const reminder = await service.set({
      guildId: ' guild-1 ',
      channelId: ' thread-1 ',
      parentChannelId: ' channel-1 ',
      ownerUserId: ' user-1 ',
      duration: '10 minutes',
      message: '  Check the oven  ',
    });

    expect(reminder.message).toBe('Check the oven');
    expect(reminder.dueAt.getTime()).toBe(now.getTime() + 600_000);
    expect(reminder).toMatchObject({
      guildId: 'guild-1',
      channelId: 'thread-1',
      parentChannelId: 'channel-1',
      ownerUserId: 'user-1',
      id: 'abcdef234567',
    });
    expect(consumedKeys).toEqual([JSON.stringify(['guild-1', 'user-1'])]);
  });

  it.each(['', 'x'.repeat(501)])(
    'rejects messages outside the allowed range',
    async (message) => {
      const { service } = fixture();

      await expect(
        service.set({ ...request(), message }),
      ).rejects.toMatchObject({ code: 'invalid-request' });
    },
  );

  it.each([
    { guildId: ' ' },
    { channelId: '' },
    { ownerUserId: '  ' },
    { parentChannelId: ' ' },
  ])('rejects blank identifiers', async (invalidFields) => {
    const { service } = fixture();

    await expect(
      service.set({ ...request(), ...invalidFields }),
    ).rejects.toMatchObject({ code: 'invalid-request' });
  });

  it('rejects an invalid duration before storage', async () => {
    const { service, store } = fixture();

    await expect(
      service.set({ ...request(), duration: 'tomorrow' }),
    ).rejects.toMatchObject({ code: 'invalid-request' });
    expect(store.created).toEqual([]);
  });

  it('maps rate-limit and active-limit failures to public service errors', async () => {
    const rateLimited = fixture({ allowed: false, retryAfterMs: 1234 }).service;
    await expect(rateLimited.set(request())).rejects.toEqual(
      new ReminderServiceError('rate-limit', 1234),
    );

    const activeLimitStore = new InMemoryReminderStore();
    activeLimitStore.createError = new ReminderActiveLimitError();
    const service = new ReminderService({
      store: activeLimitStore,
      rateLimiter: { consume: () => ({ allowed: true, retryAfterMs: 0 }) },
      now: () => now,
    });
    await expect(service.set(request())).rejects.toEqual(
      new ReminderServiceError('active-limit'),
    );
  });

  it('lists and cancels only owned reminders idempotently', async () => {
    const consumedKeys: string[] = [];
    const store = new InMemoryReminderStore();
    const service = new ReminderService({
      store,
      rateLimiter: {
        consume: (key) => {
          consumedKeys.push(key);
          return { allowed: true, retryAfterMs: 0 };
        },
      },
      now: () => now,
    });
    store.reminders.push(
      reminder({ id: 'abcdef234567', ownerUserId: 'user-1' }),
      reminder({ id: 'bcdefg234567', ownerUserId: 'user-2' }),
    );

    await expect(
      service.list({ guildId: 'guild-1', ownerUserId: 'user-1' }),
    ).resolves.toHaveLength(1);
    await expect(
      service.cancel({
        guildId: 'guild-1',
        ownerUserId: 'user-1',
        reminderId: 'abcdef234567',
      }),
    ).resolves.toMatchObject({ status: 'cancelled' });
    await expect(
      service.cancel({
        guildId: 'guild-1',
        ownerUserId: 'user-1',
        reminderId: 'abcdef234567',
      }),
    ).resolves.toMatchObject({ status: 'cancelled' });
    await expect(
      service.cancel({
        guildId: 'guild-1',
        ownerUserId: 'user-1',
        reminderId: 'bcdefg234567',
      }),
    ).resolves.toBeUndefined();
    expect(consumedKeys).toEqual([
      JSON.stringify(['guild-1', 'user-1']),
      JSON.stringify(['guild-1', 'user-1']),
      JSON.stringify(['guild-1', 'user-1']),
      JSON.stringify(['guild-1', 'user-1']),
    ]);
  });

  it('rejects invalid clocks', async () => {
    const { store } = fixture();
    const service = new ReminderService({
      store,
      rateLimiter: { consume: () => ({ allowed: true, retryAfterMs: 0 }) },
      now: () => new Date(Number.NaN),
    });

    await expect(service.set(request())).rejects.toMatchObject({
      code: 'invalid-request',
    });
  });

  it.each([
    ['a non-string duration', { duration: 600_000 }],
    ['a non-string message', { message: null }],
    ['a missing owner identifier', { ownerUserId: undefined }],
    ['a non-string parent channel identifier', { parentChannelId: 4 }],
  ])(
    'rejects %s with a public invalid-request error',
    async (_case, fields) => {
      const { service } = fixture();

      await expect(
        service.set({ ...request(), ...fields } as never),
      ).rejects.toEqual(new ReminderServiceError('invalid-request'));
    },
  );

  it('rejects missing list and cancel properties with public invalid-request errors', async () => {
    const { service } = fixture();

    await expect(service.list({ guildId: 'guild-1' } as never)).rejects.toEqual(
      new ReminderServiceError('invalid-request'),
    );
    await expect(
      service.cancel({ guildId: 'guild-1', ownerUserId: 'user-1' } as never),
    ).rejects.toEqual(new ReminderServiceError('invalid-request'));
  });

  it('rejects a non-Date clock result with a public invalid-request error', async () => {
    const { store } = fixture();
    const service = new ReminderService({
      store,
      rateLimiter: { consume: () => ({ allowed: true, retryAfterMs: 0 }) },
      now: () => 'not a date' as never,
    });

    await expect(service.set(request())).rejects.toEqual(
      new ReminderServiceError('invalid-request'),
    );
  });
});

function fixture(result = { allowed: true, retryAfterMs: 0 }): {
  service: ReminderService;
  store: InMemoryReminderStore;
} {
  const store = new InMemoryReminderStore();
  return {
    store,
    service: new ReminderService({
      store,
      rateLimiter: { consume: () => result },
      now: () => now,
      createId: () => 'abcdef234567',
    }),
  };
}

function request(): {
  guildId: string;
  channelId: string;
  ownerUserId: string;
  duration: string;
  message: string;
} {
  return {
    guildId: 'guild-1',
    channelId: 'channel-1',
    ownerUserId: 'user-1',
    duration: '10 minutes',
    message: 'Check the oven',
  };
}

function reminder(overrides: Partial<ReminderView> = {}): ReminderView {
  return {
    id: 'abcdef234567',
    guildId: 'guild-1',
    channelId: 'channel-1',
    ownerUserId: 'user-1',
    message: 'Check the oven',
    dueAt: new Date(now.getTime() + 600_000),
    status: 'pending',
    attemptCount: 0,
    createdAt: new Date(now),
    ...overrides,
  };
}

class InMemoryReminderStore implements ReminderStore {
  readonly reminders: ReminderView[] = [];
  readonly created: CreateReminderInput[] = [];
  createError: Error | undefined;

  async create(input: CreateReminderInput): Promise<ReminderView> {
    if (this.createError !== undefined) throw this.createError;
    this.created.push(input);
    const created = reminder({ ...input, status: 'pending', attemptCount: 0 });
    this.reminders.push(created);
    return created;
  }

  async listByOwner(
    guildId: string,
    ownerUserId: string,
  ): Promise<readonly ReminderView[]> {
    return this.reminders.filter(
      (entry) => entry.guildId === guildId && entry.ownerUserId === ownerUserId,
    );
  }

  async cancelOwned(
    guildId: string,
    ownerUserId: string,
    reminderId: string,
    cancelledAt: Date,
  ): Promise<ReminderView | undefined> {
    const entry = this.reminders.find(
      (candidate) =>
        candidate.id === reminderId &&
        candidate.guildId === guildId &&
        candidate.ownerUserId === ownerUserId,
    );
    if (entry === undefined) return undefined;
    if (entry.status === 'cancelled') return entry;
    const cancelled = { ...entry, status: 'cancelled' as const, cancelledAt };
    this.reminders.splice(this.reminders.indexOf(entry), 1, cancelled);
    return cancelled;
  }

  async recoverExpiredClaims(): Promise<number> {
    return 0;
  }
  async claimDue(): Promise<readonly ReminderView[]> {
    return [];
  }
  async markDelivered(): Promise<void> {}
  async markRetry(): Promise<void> {}
  async markFailed(): Promise<void> {}
  async markDeliveryUncertain(): Promise<void> {}
  async cleanup(): Promise<number> {
    return 0;
  }
  async statusCounts() {
    return { pending: 0, retryPending: 0, deliveryUncertain: 0, failed: 0 };
  }
  async healthCheck(): Promise<boolean> {
    return true;
  }
  async closeConnection(): Promise<void> {}
}
