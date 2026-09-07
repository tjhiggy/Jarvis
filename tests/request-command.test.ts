import { describe, expect, it, vi } from 'vitest';
import {
  CAPTAINS_QUARTERS_CHANNEL_ID,
  formatRequestIssue,
  formatRequestMessage,
  handleRequestCommand,
} from '../src/commands/request.js';

const safeMentions = { parse: [], repliedUser: false };
const issueUrl = 'https://github.com/tjhiggy/Jarvis/issues/401';

describe('/request', () => {
  it('creates a GitHub issue and includes its URL on the public REQUEST', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
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
      }),
      {
        adminRoleIds: new Set(['admin-role']),
        issues: { createIssue },
      },
    );

    expect(createIssue).toHaveBeenCalledWith(
      formatRequestIssue(
        'Refresh the FAQ',
        'Members keep asking the same onboarding questions.',
        'FAQ answers match the current ship rules.',
      ),
    );
    expect(reply).toHaveBeenCalledWith({
      content: formatRequestMessage(
        'Refresh the FAQ',
        'Members keep asking the same onboarding questions.',
        'FAQ answers match the current ship rules.',
        issueUrl,
      ),
      ephemeral: false,
      allowedMentions: safeMentions,
    });
    expect(reply.mock.calls[0]?.[0]?.content).toContain(issueUrl);
  });

  it('fails closed in the wrong channel without creating an issue or posting a REQUEST', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const createIssue = vi.fn();
    await handleRequestCommand(
      interaction({
        channelId: 'other-channel',
        admin: true,
        what: 'Refresh the FAQ',
        why: 'Members keep asking the same onboarding questions.',
        done: 'FAQ answers match the current ship rules.',
        reply,
      }),
      {
        adminRoleIds: new Set(['admin-role']),
        issues: { createIssue },
      },
    );

    expect(createIssue).not.toHaveBeenCalled();
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
    await handleRequestCommand(
      interaction({
        channelId: CAPTAINS_QUARTERS_CHANNEL_ID,
        admin: false,
        what: 'Refresh the FAQ',
        why: 'Members keep asking the same onboarding questions.',
        done: 'FAQ answers match the current ship rules.',
        reply,
      }),
      {
        adminRoleIds: new Set(['admin-role']),
        issues: { createIssue },
      },
    );

    expect(createIssue).not.toHaveBeenCalled();
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
    const createIssue = vi.fn().mockRejectedValue(new Error('GitHub outage'));
    await handleRequestCommand(
      interaction({
        channelId: CAPTAINS_QUARTERS_CHANNEL_ID,
        admin: true,
        what: 'Refresh the FAQ',
        why: 'Members keep asking the same onboarding questions.',
        done: 'FAQ answers match the current ship rules.',
        reply,
      }),
      {
        adminRoleIds: new Set(['admin-role']),
        issues: { createIssue },
      },
    );

    expect(createIssue).toHaveBeenCalledOnce();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/could not be created/i),
        ephemeral: true,
        allowedMentions: safeMentions,
      }),
    );
    expect(reply.mock.calls[0]?.[0]?.content).not.toMatch(/^REQUEST/m);
    expect(reply.mock.calls[0]?.[0]?.content).not.toMatch(/github\.com/i);
    expect(reply.mock.calls[0]?.[0]?.content).not.toMatch(/#\d+/);
  });

  it('fails closed when issue creation is not configured', async () => {
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
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedMentions: safeMentions,
        ephemeral: false,
        content: expect.stringMatching(/^REQUEST\nwhat:/),
      }),
    );
    expect(reply.mock.calls[0]?.[0]?.content).toContain(issueUrl);
    expect(reply.mock.calls[0]?.[0]?.content).not.toContain(
      '<@123456789012345678>',
    );
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
