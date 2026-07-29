import { describe, expect, it } from 'vitest';
import {
  DiscordPollController,
  type PollControllerDependencies,
} from '../src/polls/poll-controller.js';
import { PollMessageGatewayError } from '../src/polls/poll-message-gateway.js';
import {
  PollServiceError,
  type PollService,
} from '../src/polls/poll-service.js';
import type { PollView } from '../src/polls/poll-types.js';

const poll = (overrides: Partial<PollView> = {}): PollView => ({
  id: 'abcde234567a',
  guildId: 'guild-1',
  conversationId: 'conversation-1',
  channelId: 'channel-1',
  creatorUserId: 'admin-1',
  question: 'A private question that must not reach logs',
  status: 'active',
  closesAt: new Date('2026-07-29T13:00:00.000Z'),
  syncState: 'synced',
  syncAttempts: 0,
  options: [
    { index: 0, label: 'Red', voteCount: 1 },
    { index: 1, label: 'Blue', voteCount: 0 },
  ],
  ...overrides,
});

describe('DiscordPollController', () => {
  it('reserves, publicly creates, and activates a poll in order', async () => {
    const calls: string[] = [];
    const service = createService({
      reserve: async () => {
        calls.push('reserve');
        return poll();
      },
      activate: async () => {
        calls.push('activate');
        return poll({ messageId: 'message-1' });
      },
    });
    const controller = new DiscordPollController({
      service,
      gateway: createGateway({
        create: async () => {
          calls.push('create');
          return 'message-1';
        },
      }),
    });

    await controller.create(createRequest());
    expect(calls).toEqual(['reserve', 'create', 'activate']);
  });

  it('marks failed on creation error and marks an already-created message unavailable on activation error', async () => {
    const first = createService();
    const createFailure = new DiscordPollController({
      service: first,
      gateway: createGateway({
        create: async () => {
          throw new PollMessageGatewayError('network');
        },
      }),
    });
    await expect(createFailure.create(createRequest())).rejects.toBeInstanceOf(
      PollMessageGatewayError,
    );
    expect(first.failed).toEqual(['abcde234567a']);

    const second = createService({
      activate: async () => {
        throw new PollServiceError('storage_error');
      },
    });
    const unavailable: PollView[] = [];
    const activationFailure = new DiscordPollController({
      service: second,
      gateway: createGateway({
        markUnavailable: async (value) => {
          unavailable.push(value);
        },
      }),
    });
    await activationFailure.create(createRequest());
    expect(unavailable).toEqual([
      expect.objectContaining({ messageId: 'message-1' }),
    ]);
    expect(second.failed).toEqual(['abcde234567a']);
  });

  it('privately acknowledges a vote and retries a failed live update without raw voter telemetry', async () => {
    const service = createService();
    const logs: Record<string, unknown>[] = [];
    const controller = new DiscordPollController({
      service,
      gateway: createGateway({
        update: async () => {
          throw new PollMessageGatewayError('network');
        },
      }),
      now: () => new Date('2026-07-29T12:00:00.000Z'),
      logger: {
        info: (context) => logs.push(context),
        warn: (context) => logs.push(context),
      },
    });
    const acknowledgements: string[] = [];

    await controller.vote({
      pollId: 'abcde234567a',
      guildId: 'guild-1',
      voterUserId: 'raw-voter-id',
      optionIndex: 0,
      acknowledge: async (message) => {
        acknowledgements.push(message);
      },
    });

    expect(acknowledgements).toEqual([
      'Vote recorded. Live totals are refreshing.',
    ]);
    expect(service.pending).toEqual([
      ['abcde234567a', new Date('2026-07-29T12:00:30.000Z')],
    ]);
    expect(JSON.stringify(logs)).not.toContain('raw-voter-id');
    expect(JSON.stringify(logs)).not.toContain(poll().question);
  });

  it('orphan-marks unknown messages and caps retry scheduling after five attempts', async () => {
    const unknownService = createService();
    const unknownController = new DiscordPollController({
      service: unknownService,
      gateway: createGateway({
        update: async () => {
          throw new PollMessageGatewayError('unknown-message');
        },
      }),
    });
    await unknownController.synchronize(poll());
    expect(unknownService.orphaned).toEqual(['abcde234567a']);

    const cappedService = createService();
    const cappedController = new DiscordPollController({
      service: cappedService,
      gateway: createGateway({
        update: async () => {
          throw new PollMessageGatewayError('rate-limit');
        },
      }),
    });
    await cappedController.synchronize(poll({ syncAttempts: 5 }));
    expect(cappedService.pending).toEqual([]);
    expect(cappedService.orphaned).toEqual(['abcde234567a']);
  });

  it('closes early, synchronizes disabled final results, then privately confirms', async () => {
    const calls: string[] = [];
    const service = createService({
      close: async () => {
        calls.push('close');
        return poll({ status: 'closed' });
      },
      markSynced: async () => {
        calls.push('synced');
      },
    });
    const controller = new DiscordPollController({
      service,
      gateway: createGateway({
        update: async (value) => {
          calls.push(value.status);
        },
      }),
    });
    const replies: string[] = [];

    await controller.close({
      pollId: 'abcde234567a',
      acknowledge: async (message) => {
        replies.push(message);
      },
    });

    expect(calls).toEqual(['close', 'closed', 'synced']);
    expect(replies).toEqual(['Poll closed. Final results are now displayed.']);
  });
});

function createRequest() {
  return {
    guildId: 'guild-1',
    conversationId: 'conversation-1',
    channelId: 'channel-1',
    creatorUserId: 'admin-1',
    question: 'Question',
    options: ['Red', 'Blue'],
    duration: '1h' as const,
    target: {
      editReply: async () => undefined,
      fetchReply: async () => ({ id: 'message-1' }),
    },
  };
}

function createService(overrides: Partial<PollService> = {}): PollService & {
  readonly failed: string[];
  readonly pending: [string, Date][];
  readonly orphaned: string[];
} {
  const failed: string[] = [];
  const pending: [string, Date][] = [];
  const orphaned: string[] = [];
  return {
    failed,
    pending,
    orphaned,
    reserve: async () => poll(),
    activate: async (_pollId, messageId) => poll({ messageId }),
    fail: async (pollId) => {
      failed.push(pollId);
    },
    vote: async () => ({ kind: 'recorded', poll: poll() }),
    close: async () => poll({ status: 'closed' }),
    closeExpired: async () => [],
    cleanup: async () => 0,
    markSynced: async () => undefined,
    markPendingSync: async (pollId, retryAt) => {
      pending.push([pollId, retryAt]);
    },
    markOrphaned: async (pollId) => {
      orphaned.push(pollId);
    },
    ...overrides,
  };
}

function createGateway(
  overrides: Partial<PollControllerDependencies['gateway']> = {},
): PollControllerDependencies['gateway'] {
  return {
    create: async () => 'message-1',
    update: async () => undefined,
    markUnavailable: async () => undefined,
    ...overrides,
  };
}
