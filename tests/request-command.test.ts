import { describe, expect, it, vi } from 'vitest';
import {
  CAPTAINS_QUARTERS_CHANNEL_ID,
  formatRequestMessage,
  handleRequestCommand,
} from '../src/commands/request.js';

const safeMentions = { parse: [], repliedUser: false };

describe('/request', () => {
  it('posts a public REQUEST for an administrator in captains-quarters', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleRequestCommand(
      interaction({
        channelId: CAPTAINS_QUARTERS_CHANNEL_ID,
        admin: true,
        what: 'Refresh the FAQ',
        why: 'Members keep asking the same onboarding questions.',
        done: 'FAQ answers match the current ship rules.',
        reply,
      }),
      { adminRoleIds: new Set(['admin-role']) },
    );

    expect(reply).toHaveBeenCalledWith({
      content: formatRequestMessage(
        'Refresh the FAQ',
        'Members keep asking the same onboarding questions.',
        'FAQ answers match the current ship rules.',
      ),
      ephemeral: false,
      allowedMentions: safeMentions,
    });
  });

  it('fails closed in the wrong channel without posting a REQUEST', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleRequestCommand(
      interaction({
        channelId: 'other-channel',
        admin: true,
        what: 'Refresh the FAQ',
        why: 'Members keep asking the same onboarding questions.',
        done: 'FAQ answers match the current ship rules.',
        reply,
      }),
      { adminRoleIds: new Set(['admin-role']) },
    );

    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/captains-quarters/i),
        ephemeral: true,
        allowedMentions: safeMentions,
      }),
    );
    expect(reply.mock.calls[0]?.[0]?.content).not.toMatch(/^REQUEST/m);
  });

  it('denies non-administrators without posting a REQUEST', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleRequestCommand(
      interaction({
        channelId: CAPTAINS_QUARTERS_CHANNEL_ID,
        admin: false,
        what: 'Refresh the FAQ',
        why: 'Members keep asking the same onboarding questions.',
        done: 'FAQ answers match the current ship rules.',
        reply,
      }),
      { adminRoleIds: new Set(['admin-role']) },
    );

    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/administrator/i),
        ephemeral: true,
        allowedMentions: safeMentions,
      }),
    );
    expect(reply.mock.calls[0]?.[0]?.content).not.toMatch(/^REQUEST/m);
  });

  it('keeps allowedMentions empty on the public REQUEST post', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleRequestCommand(
      interaction({
        channelId: CAPTAINS_QUARTERS_CHANNEL_ID,
        admin: true,
        what: 'Ping <@123456789012345678> about the rollout',
        why: 'Need confirmation before launch.',
        done: 'Rollout approved in captains-quarters.',
        reply,
      }),
      { adminRoleIds: new Set(['admin-role']) },
    );

    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedMentions: safeMentions,
        ephemeral: false,
        content: expect.stringMatching(/^REQUEST\nwhat:/),
      }),
    );
    expect(reply.mock.calls[0]?.[0]?.content).not.toContain('<@123456789012345678>');
  });
});

function interaction(input: {
  channelId: string;
  admin: boolean;
  what: string;
  why: string;
  done: string;
  reply: (payload: unknown) => Promise<unknown>;
}) {
  return {
    guildId: 'guild-1',
    channelId: input.channelId,
    member: {
      roles: {
        cache: {
          has: (role: string) => input.admin && role === 'admin-role',
        },
      },
    },
    options: {
      getString: (name: string) => {
        if (name === 'what') return input.what;
        if (name === 'why') return input.why;
        if (name === 'done') return input.done;
        return null;
      },
    },
    reply: input.reply,
  };
}
