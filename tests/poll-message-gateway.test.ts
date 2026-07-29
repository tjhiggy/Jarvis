import { describe, expect, it } from 'vitest';
import {
  DiscordPollMessageGateway,
  PollMessageGatewayError,
} from '../src/polls/poll-message-gateway.js';
import {
  renderPollMessage,
  renderUnavailablePollMessage,
} from '../src/polls/poll-renderer.js';
import type { PollView } from '../src/polls/poll-types.js';

const poll = (overrides: Partial<PollView> = {}): PollView => ({
  id: 'abcde234567a',
  guildId: 'guild-1',
  conversationId: 'channel-1',
  channelId: 'channel-1',
  creatorUserId: 'admin-1',
  question: 'Should @everyone visit <@123>?',
  status: 'active',
  closesAt: new Date('2026-08-01T12:00:00.000Z'),
  syncState: 'synced',
  syncAttempts: 0,
  options: [
    { index: 0, label: 'Yes @here', voteCount: 3 },
    { index: 1, label: 'No <@&456>', voteCount: 1 },
  ],
  ...overrides,
});

const toJson = (value: unknown): Record<string, unknown> =>
  (value as { toJSON(): Record<string, unknown> }).toJSON();

describe('poll message renderer', () => {
  it('renders safe live totals, percentages, timestamps, and two vote buttons', () => {
    const rendered = renderPollMessage(poll());
    const embed = toJson(rendered.embeds[0]);
    const row = toJson(rendered.components[0]);
    const fields = embed.fields as { name: string; value: string }[];
    const buttons = row.components as {
      custom_id: string;
      disabled: boolean;
    }[];

    expect(embed.description).toContain(
      'Should @\u200beveryone visit <@\u200b123>?',
    );
    expect(embed.description).toContain('<t:1785585600:R>');
    expect(embed.footer).toEqual({
      text: 'Poll ID: abcde234567a • 4 participants',
    });
    expect(fields).toEqual([
      expect.objectContaining({
        name: 'Option 1',
        value: expect.stringContaining('Yes @\u200bhere'),
      }),
      expect.objectContaining({
        name: 'Option 2',
        value: expect.stringContaining('1 vote • 25%'),
      }),
    ]);
    expect(fields[0]?.value).toContain('3 votes • 75%');
    expect(buttons).toEqual([
      expect.objectContaining({
        custom_id: 'poll:v1:abcde234567a:0',
        disabled: false,
      }),
      expect.objectContaining({
        custom_id: 'poll:v1:abcde234567a:1',
        disabled: false,
      }),
    ]);
    expect(rendered.allowedMentions).toEqual({ parse: [], repliedUser: false });
  });

  it('renders five zero-vote options within Discord limits and disables closed polls', () => {
    const rendered = renderPollMessage(
      poll({
        status: 'closed',
        closedAt: new Date('2026-08-01T11:00:00.000Z'),
        options: Array.from({ length: 5 }, (_, index) => ({
          index,
          label: `Option ${index + 1} ${'🛸'.repeat(40)} @everyone`,
          voteCount: 0,
        })),
      }),
    );
    const embed = toJson(rendered.embeds[0]);
    const row = toJson(rendered.components[0]);
    const fields = embed.fields as { value: string }[];
    const buttons = row.components as {
      label: string;
      custom_id: string;
      disabled: boolean;
    }[];

    expect(embed.description).toContain('Closed <t:1785582000:F>');
    expect(embed.footer).toEqual({
      text: 'Poll ID: abcde234567a • 0 participants',
    });
    expect(fields).toHaveLength(5);
    expect(fields.every((field) => field.value.includes('0 votes • 0%'))).toBe(
      true,
    );
    expect(buttons).toHaveLength(5);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(
      buttons.every(
        (button) =>
          button.label.length <= 80 &&
          /^poll:v1:abcde234567a:[0-4]$/.test(button.custom_id),
      ),
    ).toBe(true);
    expect(rendered.embeds).toHaveLength(1);
    expect(rendered.components).toHaveLength(1);
  });

  it('renders an unavailable state with disabled controls', () => {
    const rendered = renderUnavailablePollMessage(poll());
    const embed = toJson(rendered.embeds[0]);
    const row = toJson(rendered.components[0]);
    const buttons = row.components as { disabled: boolean }[];

    expect(embed.title).toBe('Muthaship Poll Unavailable');
    expect(embed.description).toContain('temporarily unavailable');
    expect(buttons.every((button) => button.disabled)).toBe(true);
  });
});

describe('Discord poll message gateway', () => {
  it('publishes a deferred public reply and captures its Jarvis message ID', async () => {
    const edits: unknown[] = [];
    const gateway = new DiscordPollMessageGateway({
      botUserId: 'jarvis-1',
      fetchChannel: async () => undefined,
    });
    const target = {
      editReply: async (payload: unknown) => {
        edits.push(payload);
      },
      fetchReply: async () => ({ id: 'jarvis-message-1' }),
    };

    await expect(gateway.create(target, poll())).resolves.toBe(
      'jarvis-message-1',
    );
    expect(edits).toHaveLength(1);
    expect(toJson((edits[0] as { embeds: unknown[] }).embeds[0]).title).toBe(
      'Muthaship Poll',
    );
  });

  it('updates only a message authored by Jarvis and can mark it unavailable', async () => {
    const edits: unknown[] = [];
    const message = {
      author: { id: 'jarvis-1' },
      edit: async (payload: unknown) => {
        edits.push(payload);
      },
    };
    const gateway = new DiscordPollMessageGateway({
      botUserId: 'jarvis-1',
      fetchChannel: async () => ({
        messages: { fetch: async () => message },
      }),
    });
    const active = poll({ messageId: 'jarvis-message-1' });

    await gateway.update(active);
    await gateway.markUnavailable(active);

    expect(edits).toHaveLength(2);
    expect(toJson((edits[1] as { embeds: unknown[] }).embeds[0]).title).toBe(
      'Muthaship Poll Unavailable',
    );
  });

  it('rejects foreign messages and maps Discord failures without leaking poll content', async () => {
    const secretQuestion = 'do not leak this question';
    const gateway = new DiscordPollMessageGateway({
      botUserId: 'jarvis-1',
      fetchChannel: async () => ({
        messages: {
          fetch: async () => ({
            author: { id: 'someone-else' },
            edit: async () => undefined,
          }),
        },
      }),
    });

    await expect(
      gateway.update(
        poll({ messageId: 'message-1', question: secretQuestion }),
      ),
    ).rejects.toMatchObject({ category: 'permission' });

    const rateLimited = new DiscordPollMessageGateway({
      botUserId: 'jarvis-1',
      fetchChannel: async () => {
        throw Object.assign(new Error(secretQuestion), { status: 429 });
      },
    });

    await expect(
      rateLimited.update(poll({ messageId: 'message-1' })),
    ).rejects.toBeInstanceOf(PollMessageGatewayError);
    await expect(
      rateLimited.update(poll({ messageId: 'message-1' })),
    ).rejects.toMatchObject({
      category: 'rate-limit',
    });
    try {
      await rateLimited.update(poll({ messageId: 'message-1' }));
    } catch (error) {
      expect(String(error)).not.toContain(secretQuestion);
    }
  });
});
