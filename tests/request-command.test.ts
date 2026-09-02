import { describe, expect, it, vi } from 'vitest';
import {
  CAPTAINS_QUARTERS_CHANNEL_ID,
  DISCORD_REQUEST_CONTENT_MAX,
  formatRequestIssue,
  formatRequestMessage,
  handleRequestCommand,
} from '../src/commands/request.js';

const safeMentions = { parse: [], repliedUser: false };
const issueUrl = 'https://github.com/tjhiggy/Jarvis/issues/401';

describe('/request', () => {
  it('creates a GitHub issue and includes its URL on the public REQUEST', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const followUp = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue(undefined);
    const createIssue = vi.fn().mockResolvedValue({
      number: 401,
      url: issueUrl,
    });
    await handleRequestCommand(
      interaction({
        channelId: CAPTAINS_QUARTERS_CHANNEL_ID,
        admin: true,
        what: 'Refresh the FAQ',
        why: 'Members keep asking the same onboarding questions.',
        done: 'FAQ answers match the current ship rules.',
        reply,
        deferReply,
        editReply,
        followUp,
        send,
      }),
      {
        adminRoleIds: new Set(['admin-role']),
        issues: { createIssue },
      },
    );

    expect(deferReply).toHaveBeenCalledWith({
      ephemeral: true,
      allowedMentions: safeMentions,
    });
    expect(deferReply.mock.invocationCallOrder[0]).toBeLessThan(
      createIssue.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(createIssue).toHaveBeenCalledWith(
      formatRequestIssue(
        'Refresh the FAQ',
        'Members keep asking the same onboarding questions.',
        'FAQ answers match the current ship rules.',
      ),
    );
    expect(send).toHaveBeenCalledWith({
      content: formatRequestMessage(
        'Refresh the FAQ',
        'Members keep asking the same onboarding questions.',
        'FAQ answers match the current ship rules.',
        issueUrl,
      ),
      allowedMentions: safeMentions,
    });
    expect(send.mock.calls[0]?.[0]?.content).toContain(issueUrl);
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(issueUrl),
        allowedMentions: safeMentions,
      }),
    );
    expect(reply).not.toHaveBeenCalled();
    expect(followUp).not.toHaveBeenCalled();
  });

  it('fails closed in the wrong channel without creating an issue or posting a REQUEST', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const createIssue = vi.fn();
    const deferReply = vi.fn();
    await handleRequestCommand(
      interaction({
        channelId: 'other-channel',
        admin: true,
        what: 'Refresh the FAQ',
        why: 'Members keep asking the same onboarding questions.',
        done: 'FAQ answers match the current ship rules.',
        reply,
        deferReply,
      }),
      {
        adminRoleIds: new Set(['admin-role']),
        issues: { createIssue },
      },
    );

    expect(createIssue).not.toHaveBeenCalled();
    expect(deferReply).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/captains-quarters/i),
        ephemeral: true,
        allowedMentions: safeMentions,
      }),
    );
    expect(reply.mock.calls[0]?.[0]?.content).not.toMatch(/^REQUEST/m);
    expect(reply.mock.calls[0]?.[0]?.content).not.toMatch(/github\.com/i);
  });

  it('denies non-administrators without creating an issue or posting a REQUEST', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const createIssue = vi.fn();
    const deferReply = vi.fn();
    await handleRequestCommand(
      interaction({
        channelId: CAPTAINS_QUARTERS_CHANNEL_ID,
        admin: false,
        what: 'Refresh the FAQ',
        why: 'Members keep asking the same onboarding questions.',
        done: 'FAQ answers match the current ship rules.',
        reply,
        deferReply,
      }),
      {
        adminRoleIds: new Set(['admin-role']),
        issues: { createIssue },
      },
    );

    expect(createIssue).not.toHaveBeenCalled();
    expect(deferReply).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/administrator/i),
        ephemeral: true,
        allowedMentions: safeMentions,
      }),
    );
    expect(reply.mock.calls[0]?.[0]?.content).not.toMatch(/^REQUEST/m);
    expect(reply.mock.calls[0]?.[0]?.content).not.toMatch(/github\.com/i);
  });

  it('keeps a GitHub failure ephemeral without a public REQUEST or fake issue link', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn();
    const createIssue = vi.fn().mockRejectedValue(new Error('GitHub outage'));
    await handleRequestCommand(
      interaction({
        channelId: CAPTAINS_QUARTERS_CHANNEL_ID,
        admin: true,
        what: 'Refresh the FAQ',
        why: 'Members keep asking the same onboarding questions.',
        done: 'FAQ answers match the current ship rules.',
        reply,
        deferReply,
        editReply,
        send,
      }),
      {
        adminRoleIds: new Set(['admin-role']),
        issues: { createIssue },
      },
    );

    expect(createIssue).toHaveBeenCalledOnce();
    expect(deferReply).toHaveBeenCalledWith({
      ephemeral: true,
      allowedMentions: safeMentions,
    });
    expect(send).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/could not be created/i),
        allowedMentions: safeMentions,
      }),
    );
    expect(editReply.mock.calls[0]?.[0]?.content).not.toMatch(/^REQUEST/m);
    expect(editReply.mock.calls[0]?.[0]?.content).not.toMatch(/github\.com/i);
    expect(editReply.mock.calls[0]?.[0]?.content).not.toMatch(/#\d+/);
  });

  it('fails closed when issue creation is not configured', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const deferReply = vi.fn();
    const send = vi.fn();
    await handleRequestCommand(
      interaction({
        channelId: CAPTAINS_QUARTERS_CHANNEL_ID,
        admin: true,
        what: 'Refresh the FAQ',
        why: 'Members keep asking the same onboarding questions.',
        done: 'FAQ answers match the current ship rules.',
        reply,
        deferReply,
        send,
      }),
      { adminRoleIds: new Set(['admin-role']) },
    );

    expect(deferReply).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/could not be created/i),
        ephemeral: true,
        allowedMentions: safeMentions,
      }),
    );
    expect(reply.mock.calls[0]?.[0]?.content).not.toMatch(/^REQUEST/m);
    expect(reply.mock.calls[0]?.[0]?.content).not.toMatch(/github\.com/i);
  });

  it('keeps allowedMentions empty and mentions neutralized on the public REQUEST', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue(undefined);
    const createIssue = vi.fn().mockResolvedValue({
      number: 401,
      url: issueUrl,
    });
    await handleRequestCommand(
      interaction({
        channelId: CAPTAINS_QUARTERS_CHANNEL_ID,
        admin: true,
        what: 'Ping <@123456789012345678> about the rollout',
        why: 'Need confirmation before launch.',
        done: 'Rollout approved in captains-quarters.',
        reply,
        deferReply,
        editReply,
        send,
      }),
      {
        adminRoleIds: new Set(['admin-role']),
        issues: { createIssue },
      },
    );

    expect(createIssue).toHaveBeenCalledWith(
      formatRequestIssue(
        'Ping <@123456789012345678> about the rollout',
        'Need confirmation before launch.',
        'Rollout approved in captains-quarters.',
      ),
    );
    expect(createIssue.mock.calls[0]?.[0]?.title).not.toContain(
      '<@123456789012345678>',
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedMentions: safeMentions,
        content: expect.stringMatching(/^REQUEST\nwhat:/),
      }),
    );
    expect(send.mock.calls[0]?.[0]?.content).toContain(issueUrl);
    expect(send.mock.calls[0]?.[0]?.content).not.toContain(
      '<@123456789012345678>',
    );
  });

  it('keeps a Discord REQUEST within 2000 characters while preserving the issue URL', () => {
    const what = 'W'.repeat(1_500);
    const why = 'Y'.repeat(1_500);
    const done = 'D'.repeat(1_500);
    const content = formatRequestMessage(what, why, done, issueUrl);

    expect(content.length).toBeLessThanOrEqual(DISCORD_REQUEST_CONTENT_MAX);
    expect(content.startsWith('REQUEST\nwhat: ')).toBe(true);
    expect(content.endsWith(`\nissue: ${issueUrl}`)).toBe(true);
    expect(content).toContain('…');
    expect(formatRequestIssue(what, why, done).body).toContain(what);
    expect(formatRequestIssue(what, why, done).body).toContain(why);
    expect(formatRequestIssue(what, why, done).body).toContain(done);
  });

  it('posts the public REQUEST with followUp when the channel cannot send', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const followUp = vi.fn().mockResolvedValue(undefined);
    const createIssue = vi.fn().mockResolvedValue({
      number: 401,
      url: issueUrl,
    });
    await handleRequestCommand(
      interaction({
        channelId: CAPTAINS_QUARTERS_CHANNEL_ID,
        admin: true,
        what: 'Refresh the FAQ',
        why: 'Members keep asking the same onboarding questions.',
        done: 'FAQ answers match the current ship rules.',
        reply,
        deferReply,
        editReply,
        followUp,
      }),
      {
        adminRoleIds: new Set(['admin-role']),
        issues: { createIssue },
      },
    );

    expect(followUp).toHaveBeenCalledWith({
      content: formatRequestMessage(
        'Refresh the FAQ',
        'Members keep asking the same onboarding questions.',
        'FAQ answers match the current ship rules.',
        issueUrl,
      ),
      ephemeral: false,
      allowedMentions: safeMentions,
    });
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining(issueUrl),
      }),
    );
  });

  it('defers before GitHub and still reports the issue URL if the public REQUEST send fails', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const deferReply = vi.fn().mockResolvedValue(undefined);
    const editReply = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockRejectedValue(new Error('channel send failed'));
    const createIssue = vi.fn().mockResolvedValue({
      number: 401,
      url: issueUrl,
    });
    await handleRequestCommand(
      interaction({
        channelId: CAPTAINS_QUARTERS_CHANNEL_ID,
        admin: true,
        what: 'Refresh the FAQ',
        why: 'Members keep asking the same onboarding questions.',
        done: 'FAQ answers match the current ship rules.',
        reply,
        deferReply,
        editReply,
        send,
      }),
      {
        adminRoleIds: new Set(['admin-role']),
        issues: { createIssue },
      },
    );

    expect(deferReply.mock.invocationCallOrder[0]).toBeLessThan(
      createIssue.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(createIssue).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    expect(editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/could not be posted/i),
        allowedMentions: safeMentions,
      }),
    );
    expect(editReply.mock.calls[0]?.[0]?.content).toContain(issueUrl);
    expect(reply).not.toHaveBeenCalled();
  });
});

function interaction(input: {
  channelId: string;
  admin: boolean;
  what: string;
  why: string;
  done: string;
  reply: (payload: unknown) => Promise<unknown>;
  deferReply?: (payload: unknown) => Promise<unknown>;
  editReply?: (payload: unknown) => Promise<unknown>;
  followUp?: (payload: unknown) => Promise<unknown>;
  send?: (payload: unknown) => Promise<unknown>;
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
    deferReply: input.deferReply ?? vi.fn(),
    editReply: input.editReply ?? vi.fn(),
    followUp: input.followUp ?? vi.fn(),
    channel:
      input.send === undefined
        ? null
        : {
            send: input.send,
          },
  };
}
