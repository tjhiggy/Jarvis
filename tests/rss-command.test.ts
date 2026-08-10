import { describe, expect, it, vi } from 'vitest';
import { handleRssCommand } from '../src/commands/rss.js';

const interaction = (
  action: string,
  values: Record<string, string> = {},
  admin = true,
) => {
  const reply = vi.fn().mockResolvedValue(undefined);
  return {
    value: {
      guildId: 'server-1',
      member: { roles: { cache: { has: () => admin } } },
      options: {
        getSubcommand: () => action,
        getString: (name: string) => values[name] ?? null,
      },
      reply,
    },
    reply,
  };
};

describe('handleRssCommand', () => {
  it('adds only allowlisted HTTPS feeds for administrators', async () => {
    const addFeed = vi.fn();
    const request = interaction('add', {
      url: 'https://news.example.com/feed.xml',
      label: 'News',
    });
    await handleRssCommand(request.value, {
      storage: {
        addFeed,
        listFeeds: () => [],
        removeFeed: () => false,
        setPaused: () => undefined,
      },
      adminRoleIds: new Set(['admin']),
      allowedHosts: ['news.example.com'],
    });
    expect(addFeed).toHaveBeenCalledWith(
      'server-1',
      'https://news.example.com/feed.xml',
      'News',
    );
    expect(request.reply).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true }),
    );
  });

  it('rejects unauthorized members without mutating storage', async () => {
    const addFeed = vi.fn();
    const request = interaction(
      'add',
      { url: 'https://news.example.com/feed.xml', label: 'News' },
      false,
    );
    await handleRssCommand(request.value, {
      storage: {
        addFeed,
        listFeeds: () => [],
        removeFeed: () => false,
        setPaused: () => undefined,
      },
      adminRoleIds: new Set(['admin']),
      allowedHosts: ['news.example.com'],
    });
    expect(addFeed).not.toHaveBeenCalled();
  });
});
