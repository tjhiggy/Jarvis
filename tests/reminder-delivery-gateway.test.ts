import { describe, expect, it } from 'vitest';

import {
  DiscordReminderDeliveryGateway,
  type ReminderDeliveryChannel,
} from '../src/reminders/reminder-delivery-gateway.js';
import { renderReminderMessage } from '../src/reminders/reminder-renderer.js';
import type { ReminderView } from '../src/reminders/reminder-types.js';

const now = new Date('2026-07-29T12:00:00.000Z');

describe('reminder renderer', () => {
  it('renders only an owner mention and neutralizes untrusted Discord mention forms', () => {
    const payload = renderReminderMessage(
      reminder({
        message: '@everyone @here <@123> <@!123> <@&456> <#789>',
      }),
      now,
    );

    expect(payload.allowedMentions).toEqual({
      parse: [],
      users: ['owner-1'],
      repliedUser: false,
    });
    expect(payload.content).toContain('<@owner-1>');
    expect(payload.content).not.toContain('<@&456>');
    expect(payload.content).not.toContain('<#789>');
    expect(payload.content).toContain('@\u200beveryone');
    expect(payload.content).toContain('<@\u200b123>');
  });

  it('uses plain on-time wording and approximate overdue wording without exposing stored timestamps', () => {
    const onTime = renderReminderMessage(reminder(), now);
    const overdue = renderReminderMessage(
      reminder({ dueAt: new Date('2026-07-29T11:55:00.000Z') }),
      now,
    );

    expect(onTime.content).toContain('Reminder: Check the oven');
    expect(overdue.content).toContain(
      'Reminder from about 5 minutes ago: Check the oven',
    );
    expect(overdue.content).not.toContain('2026-07-29');
    expect(overdue.content).not.toContain('<t:');
  });

  it('stays within Discords content limit for a maximum-length reminder', () => {
    const payload = renderReminderMessage(
      reminder({ message: 'x'.repeat(500) }),
      now,
    );

    expect(payload.content.length).toBeLessThanOrEqual(2_000);
  });
});

describe('DiscordReminderDeliveryGateway', () => {
  it.each([
    ['guild', { guildId: 'guild-2' }],
    ['channel', { id: 'channel-2' }],
  ] as const)(
    'refuses a live destination with a mismatched stored %s identity',
    async (_scope, mismatch) => {
      const sent: unknown[] = [];
      const gateway = gatewayFor(
        channel({
          send: async (payload) => void sent.push(payload),
          ...mismatch,
        }),
      );

      await expect(gateway.deliver(reminder(), now)).resolves.toEqual({
        kind: 'permanent-failure',
        category: 'permission',
      });
      expect(sent).toEqual([]);
    },
  );

  it('refuses a thread whose live parent differs from its stored parent', async () => {
    const gateway = gatewayFor(
      channel({ id: 'thread-1', parentId: 'parent-2' }),
    );

    await expect(
      gateway.deliver(
        reminder({ channelId: 'thread-1', parentChannelId: 'parent-1' }),
        now,
      ),
    ).resolves.toEqual({ kind: 'permanent-failure', category: 'permission' });
  });

  it('delivers exactly once to an allowed channel with an owner-only payload', async () => {
    const sent: unknown[] = [];
    const gateway = gatewayFor(
      channel({ send: async (payload) => void sent.push(payload) }),
      new Set(['channel-1']),
    );

    await expect(gateway.deliver(reminder(), now)).resolves.toEqual({
      kind: 'delivered',
    });
    expect(sent).toEqual([
      expect.objectContaining({
        content: expect.stringContaining('<@owner-1>'),
        allowedMentions: {
          parse: [],
          users: ['owner-1'],
          repliedUser: false,
        },
      }),
    ]);
  });

  it('delivers to an allowed parent thread', async () => {
    const sent: unknown[] = [];
    const gateway = gatewayFor(
      channel({
        id: 'thread-1',
        parentId: 'parent-1',
        send: async (payload) => void sent.push(payload),
      }),
      new Set(['parent-1']),
    );

    await expect(
      gateway.deliver(
        reminder({ channelId: 'thread-1', parentChannelId: 'parent-1' }),
        now,
      ),
    ).resolves.toEqual({ kind: 'delivered' });
    expect(sent).toHaveLength(1);
  });

  it('rejects a destination outside the current allowlist without sending', async () => {
    const sent: unknown[] = [];
    const gateway = gatewayFor(
      channel({ send: async (payload) => void sent.push(payload) }),
      new Set(['other-channel']),
    );

    await expect(gateway.deliver(reminder(), now)).resolves.toEqual({
      kind: 'permanent-failure',
      category: 'permission',
    });
    expect(sent).toEqual([]);
  });

  it('categorizes missing destinations and known lookup failures before a send', async () => {
    const cases: ReadonlyArray<readonly [string, unknown, unknown]> = [
      [
        'missing channel',
        undefined,
        { kind: 'permanent-failure', category: 'unknown-channel' },
      ],
      [
        'permission',
        Object.assign(new Error('hidden'), { code: 50_013 }),
        { kind: 'permanent-failure', category: 'permission' },
      ],
      [
        'rate limit',
        Object.assign(new Error('hidden'), { status: 429 }),
        { kind: 'transient-failure', category: 'rate-limit' },
      ],
      [
        'network',
        Object.assign(new Error('hidden'), { code: 'ECONNRESET' }),
        { kind: 'transient-failure', category: 'network' },
      ],
      [
        'service',
        new Error('hidden'),
        { kind: 'transient-failure', category: 'service' },
      ],
    ];

    for (const [, result, expected] of cases) {
      const gateway = new DiscordReminderDeliveryGateway({
        allowedChannelIds: new Set(['channel-1']),
        fetchChannel: async () => {
          if (result instanceof Error) throw result;
          return result as ReminderDeliveryChannel | undefined;
        },
      });
      await expect(gateway.deliver(reminder(), now)).resolves.toEqual(expected);
    }
  });

  it.each([
    [
      'unknown channel',
      Object.assign(new Error('hidden'), { code: 10_003 }),
      { kind: 'permanent-failure', category: 'unknown-channel' },
    ],
    [
      'permission',
      Object.assign(new Error('hidden'), { code: 50_013 }),
      { kind: 'permanent-failure', category: 'permission' },
    ],
    [
      'rate limit',
      Object.assign(new Error('hidden'), { status: 429 }),
      { kind: 'transient-failure', category: 'rate-limit' },
    ],
  ] as const)(
    'categorizes a known Discord %s send rejection',
    async (_name, error, expected) => {
      const gateway = gatewayFor(
        channel({ send: async () => Promise.reject(error) }),
      );

      await expect(gateway.deliver(reminder(), now)).resolves.toEqual(expected);
    },
  );

  it.each([
    ['ECONNRESET', Object.assign(new Error('hidden'), { code: 'ECONNRESET' })],
    ['EPIPE', Object.assign(new Error('hidden'), { code: 'EPIPE' })],
    ['ETIMEDOUT', Object.assign(new Error('hidden'), { code: 'ETIMEDOUT' })],
    ['AbortError', Object.assign(new Error('hidden'), { name: 'AbortError' })],
    ['FetchError', Object.assign(new Error('hidden'), { name: 'FetchError' })],
    ['service response', Object.assign(new Error('hidden'), { status: 500 })],
  ] as const)(
    'marks a post-send %s rejection uncertain because Discord may have accepted it',
    async (_name, error) => {
      const gateway = gatewayFor(
        channel({ send: async () => Promise.reject(error) }),
      );

      await expect(gateway.deliver(reminder(), now)).resolves.toEqual({
        kind: 'uncertain',
      });
    },
  );

  it('marks an ambiguous send rejection as uncertain instead of risking a duplicate', async () => {
    const gateway = gatewayFor(
      channel({
        send: async () =>
          Promise.reject(new Error('connection outcome unknown')),
      }),
    );

    await expect(gateway.deliver(reminder(), now)).resolves.toEqual({
      kind: 'uncertain',
    });
  });
});

function gatewayFor(
  destination: ReminderDeliveryChannel | undefined,
  allowedChannelIds = new Set<string>(),
): DiscordReminderDeliveryGateway {
  return new DiscordReminderDeliveryGateway({
    allowedChannelIds,
    fetchChannel: async () => destination,
  });
}

function channel(
  overrides: Partial<ReminderDeliveryChannel> = {},
): ReminderDeliveryChannel {
  return {
    id: 'channel-1',
    guildId: 'guild-1',
    send: async () => undefined,
    ...overrides,
  };
}

function reminder(overrides: Partial<ReminderView> = {}): ReminderView {
  return {
    id: 'abcdef234567',
    guildId: 'guild-1',
    channelId: 'channel-1',
    ownerUserId: 'owner-1',
    message: 'Check the oven',
    dueAt: new Date(now),
    status: 'claimed',
    attemptCount: 0,
    createdAt: new Date('2026-07-29T11:00:00.000Z'),
    ...overrides,
  };
}
