import { describe, expect, it } from 'vitest';
import { PollCoordinator } from '../src/polls/poll-coordinator.js';
import {
  DurablePollService,
  PollServiceError,
} from '../src/polls/poll-service.js';
import type { PollStore } from '../src/polls/poll-store.js';
import type { PollView } from '../src/polls/poll-types.js';

const secret = 'poll-secret-that-is-longer-than-thirty-two-characters';
const now = new Date('2026-07-29T12:00:00.000Z');

describe('DurablePollService', () => {
  it('validates and reserves a bounded poll with a deterministic close time', async () => {
    const store = createStore();
    const service = createService(store);

    const reserved = await service.reserve(createRequest());

    expect(reserved).toMatchObject({
      id: 'abcde234567a',
      question: 'Choose a course',
      options: [{ label: 'Red' }, { label: 'Blue' }],
      closesAt: new Date(now.getTime() + 60 * 60 * 1_000),
    });
    expect(store.reserves[0]).toMatchObject({
      question: 'Choose a course',
      options: ['Red', 'Blue'],
    });
  });

  it('enforces active capacity, per-admin conversation availability, and bounded creation rate', async () => {
    const capacityStore = createStore({ activeCount: 100 });
    await expect(
      createService(capacityStore).reserve(createRequest()),
    ).rejects.toMatchObject({
      code: 'capacity_reached',
    });

    const existingStore = createStore({ hasExisting: true });
    await expect(
      createService(existingStore).reserve(createRequest()),
    ).rejects.toMatchObject({
      code: 'creator_poll_exists',
    });

    const rateStore = createStore();
    const service = createService(rateStore);
    await service.reserve(createRequest());
    await service.reserve(createRequest({ conversationId: 'conversation-2' }));
    await service.reserve(createRequest({ conversationId: 'conversation-3' }));
    await expect(
      service.reserve(createRequest({ conversationId: 'conversation-4' })),
    ).rejects.toMatchObject({ code: 'creation_rate_limited' });
  });

  it('serializes concurrent capacity checks so the active-poll ceiling cannot be exceeded', async () => {
    const store = createStore();
    let activePolls = 99;
    const reserve = store.reserve;
    store.countCapacityOccupying = async () => activePolls;
    store.reserve = async (input) => {
      activePolls += 1;
      return reserve(input);
    };
    const service = createService(store);

    const results = await Promise.allSettled([
      service.reserve(createRequest()),
      service.reserve(createRequest({ conversationId: 'conversation-2' })),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(activePolls).toBe(100);
  });

  it('converts raw voter identity to a poll-scoped key before it reaches storage', async () => {
    const store = createStore();
    const seen: string[] = [];
    const service = new DurablePollService({
      store,
      voterSecret: secret,
      now: () => now,
      createId: () => 'abcde234567a',
      createVoterKey: (_secret, guildId, pollId, userId) => {
        seen.push(`${guildId}:${pollId}:${userId}`);
        return `key:${guildId}:${pollId}:${userId}`;
      },
    });

    await service.vote({
      pollId: 'abcde234567a',
      guildId: 'guild-1',
      voterUserId: 'raw-user-id',
      optionIndex: 0,
    });

    expect(seen).toEqual(['guild-1:abcde234567a:raw-user-id']);
    expect(store.votes).toEqual([
      expect.objectContaining({
        voterKey: 'key:guild-1:abcde234567a:raw-user-id',
      }),
    ]);
    expect(store.votes[0]).not.toHaveProperty('voterUserId');
  });

  it('serializes ordered vote changes and maps storage outcomes safely', async () => {
    const store = createStore();
    const service = createService(store);

    await expect(
      Promise.all([
        service.vote({
          pollId: 'abcde234567a',
          guildId: 'guild-1',
          voterUserId: 'user-1',
          optionIndex: 0,
        }),
        service.vote({
          pollId: 'abcde234567a',
          guildId: 'guild-1',
          voterUserId: 'user-1',
          optionIndex: 1,
        }),
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ kind: 'recorded' }),
      expect.objectContaining({ kind: 'changed' }),
    ]);
    expect(store.votes.map((vote) => vote.optionIndex)).toEqual([0, 1]);

    await expect(
      service.vote({
        pollId: 'abcde234567a',
        guildId: 'guild-1',
        voterUserId: 'user-1',
        optionIndex: 5,
      }),
    ).rejects.toMatchObject({ code: 'invalid_option' });
  });

  it('closes idempotently, closes expired polls, and cleans terminal records', async () => {
    const store = createStore();
    const service = createService(store);

    await service.close({ pollId: 'abcde234567a' });
    await service.close({ pollId: 'abcde234567a' });
    await service.closeExpired(new Date('2026-07-30T00:00:00.000Z'));
    await service.cleanup(new Date('2026-08-30T00:00:00.000Z'));

    expect(store.closed).toHaveLength(2);
    expect(store.closeDueCalls).toEqual([100]);
    expect(store.cleanupCutoffs).toEqual([
      new Date('2026-08-30T00:00:00.000Z'),
    ]);
  });

  it('returns content-free typed errors', async () => {
    const store = createStore({
      reserveError: new Error('secret question leaked'),
    });
    const service = createService(store);

    await expect(service.reserve(createRequest())).rejects.toBeInstanceOf(
      PollServiceError,
    );
    await expect(service.reserve(createRequest())).rejects.toMatchObject({
      code: 'storage_error',
    });
  });
});

function createRequest(
  overrides: Partial<{
    conversationId: string;
    duration: '1h';
  }> = {},
) {
  return {
    guildId: 'guild-1',
    conversationId: 'conversation-1',
    channelId: 'channel-1',
    creatorUserId: 'admin-1',
    question: 'Choose a course',
    options: ['Red', 'Blue'],
    duration: '1h' as const,
    ...overrides,
  };
}

function createService(store: PollStore): DurablePollService {
  return new DurablePollService({
    store,
    voterSecret: secret,
    now: () => now,
    createId: () => 'abcde234567a',
    coordinator: new PollCoordinator(),
  });
}

function view(overrides: Partial<PollView> = {}): PollView {
  return {
    id: 'abcde234567a',
    guildId: 'guild-1',
    conversationId: 'conversation-1',
    channelId: 'channel-1',
    creatorUserId: 'admin-1',
    question: 'Choose a course',
    status: 'active',
    closesAt: new Date('2026-07-29T13:00:00.000Z'),
    syncState: 'synced',
    syncAttempts: 0,
    options: [
      { index: 0, label: 'Red', voteCount: 0 },
      { index: 1, label: 'Blue', voteCount: 0 },
    ],
    ...overrides,
  };
}

function createStore(
  options: Readonly<{
    activeCount?: number;
    hasExisting?: boolean;
    reserveError?: Error;
  }> = {},
): PollStore & {
  readonly reserves: unknown[];
  readonly votes: { voterKey: string; optionIndex: number }[];
  readonly closed: string[];
  readonly closeDueCalls: number[];
  readonly cleanupCutoffs: Date[];
} {
  const reserves: unknown[] = [];
  const votes: { voterKey: string; optionIndex: number }[] = [];
  const closed: string[] = [];
  const closeDueCalls: number[] = [];
  const cleanupCutoffs: Date[] = [];
  const votesByKey = new Map<string, number>();
  return {
    reserves,
    votes,
    closed,
    closeDueCalls,
    cleanupCutoffs,
    reserve: async (input) => {
      if (options.reserveError !== undefined) {
        throw options.reserveError;
      }
      reserves.push(input);
      return view({
        id: input.id,
        question: input.question,
        status: 'creating',
        syncState: 'pending',
        options: input.options.map((label, index) => ({
          index,
          label,
          voteCount: 0,
        })),
        closesAt: input.closesAt,
      });
    },
    activate: async (pollId, messageId) => view({ id: pollId, messageId }),
    markFailed: async () => undefined,
    recordVote: async (input) => {
      const previous = votesByKey.get(input.voterKey);
      votesByKey.set(input.voterKey, input.optionIndex);
      votes.push({ voterKey: input.voterKey, optionIndex: input.optionIndex });
      return {
        kind:
          previous === undefined
            ? 'recorded'
            : previous === input.optionIndex
              ? 'unchanged'
              : 'changed',
        poll: view({ id: input.pollId }),
      };
    },
    close: async (pollId) => {
      closed.push(pollId);
      return view({ id: pollId, status: 'closed' });
    },
    closeDue: async (_current, limit) => {
      closeDueCalls.push(limit);
      return [view({ status: 'closed' })];
    },
    markPendingSync: async () => undefined,
    markSynced: async () => undefined,
    markOrphaned: async () => undefined,
    listPendingSync: async () => [],
    countCapacityOccupying: async () => options.activeCount ?? 0,
    hasActiveByCreatorInConversation: async () => options.hasExisting ?? false,
    cleanup: async (cutoff) => {
      cleanupCutoffs.push(cutoff);
      return 1;
    },
    healthCheck: async () => true,
    closeConnection: async () => undefined,
  };
}
