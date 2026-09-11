import { describe, expect, it, vi } from 'vitest';
import {
  handleRssCommand,
  type RssCommandDependencies,
  type RssCommandInteraction,
} from '../src/commands/rss.js';

const interaction = (
  action: string,
  values: Record<string, string> = {},
  admin = true,
  guildId: string | null = 'server-1',
): {
  readonly value: RssCommandInteraction;
  readonly reply: ReturnType<typeof vi.fn>;
} => {
  const reply = vi.fn().mockResolvedValue(undefined);
  return {
    value: {
      guildId,
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

type RssSpies = {
  addFeed: ReturnType<typeof vi.fn>;
  listFeeds: ReturnType<typeof vi.fn>;
  removeFeed: ReturnType<typeof vi.fn>;
  setPaused: ReturnType<typeof vi.fn>;
};

const storage = (overrides: Partial<RssSpies> = {}): RssSpies => ({
  addFeed: overrides.addFeed ?? vi.fn(),
  listFeeds: overrides.listFeeds ?? vi.fn(() => []),
  removeFeed: overrides.removeFeed ?? vi.fn(() => false),
  setPaused: overrides.setPaused ?? vi.fn(),
});

const deps = (rss: RssSpies): RssCommandDependencies => ({
  storage: rss as unknown as RssCommandDependencies['storage'],
  adminRoleIds: new Set(['admin']),
  allowedHosts: ['news.example.com'],
});

describe('handleRssCommand', () => {
  it('adds only allowlisted HTTPS feeds for administrators', async () => {
    const rss = storage();
    const request = interaction('add', {
      url: 'https://news.example.com/feed.xml',
      label: 'News',
    });
    await handleRssCommand(request.value, deps(rss));
    expect(rss.addFeed).toHaveBeenCalledWith(
      'server-1',
      'https://news.example.com/feed.xml',
      'News',
    );
    expect(request.reply).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true }),
    );
  });

  it('rejects unauthorized members without mutating storage', async () => {
    const rss = storage();
    const request = interaction(
      'add',
      { url: 'https://news.example.com/feed.xml', label: 'News' },
      false,
    );
    await handleRssCommand(request.value, deps(rss));
    expect(rss.addFeed).not.toHaveBeenCalled();
    expect(rss.removeFeed).not.toHaveBeenCalled();
    expect(rss.setPaused).not.toHaveBeenCalled();
  });

  it('rejects an allowlisted HTTPS feed URL that embeds credentials', async () => {
    const rss = storage();
    const request = interaction('add', {
      url: 'https://operator:secret@news.example.com/feed.xml',
      label: 'News',
    });
    await handleRssCommand(request.value, deps(rss));
    expect(rss.addFeed).not.toHaveBeenCalled();
  });

  it('fails closed in DMs without listing or mutating feeds', async () => {
    const rss = storage();
    const request = interaction('list', {}, true, null);
    await handleRssCommand(request.value, deps(rss));
    expect(rss.listFeeds).not.toHaveBeenCalled();
    expect(rss.addFeed).not.toHaveBeenCalled();
    expect(rss.setPaused).not.toHaveBeenCalled();
    expect(request.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/only available aboard the MuthaShip/i),
        ephemeral: true,
        allowedMentions: { parse: [], repliedUser: false },
      }),
    );
  });

  it('lists empty and paused feeds privately for administrators', async () => {
    const empty = interaction('list');
    const emptyStorage = storage();
    await handleRssCommand(empty.value, deps(emptyStorage));
    expect(emptyStorage.listFeeds).toHaveBeenCalledWith('server-1');
    expect(empty.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'No RSS feeds are configured.',
        ephemeral: true,
      }),
    );

    const listed = interaction('list');
    await handleRssCommand(
      listed.value,
      deps(
        storage({
          listFeeds: vi.fn(() => [
            {
              serverId: 'server-1',
              label: 'News',
              url: 'https://news.example.com/feed.xml',
              paused: true,
              baselined: true,
            },
            {
              serverId: 'server-1',
              label: 'Alerts',
              url: 'https://news.example.com/alerts.xml',
              paused: false,
              baselined: true,
            },
          ]),
        }),
      ),
    );
    expect(listed.reply.mock.calls[0]?.[0]?.content).toContain(
      '• News: https://news.example.com/feed.xml (paused)',
    );
    expect(listed.reply.mock.calls[0]?.[0]?.content).toContain(
      '• Alerts: https://news.example.com/alerts.xml',
    );
    expect(listed.reply.mock.calls[0]?.[0]?.content).not.toContain(
      'Alerts: https://news.example.com/alerts.xml (paused)',
    );
  });

  it('pauses and resumes monitoring without adding or removing feeds', async () => {
    const rss = storage();
    const pause = interaction('pause');
    await handleRssCommand(pause.value, deps(rss));
    const resume = interaction('resume');
    await handleRssCommand(resume.value, deps(rss));
    expect(rss.setPaused.mock.calls).toEqual([
      ['server-1', true],
      ['server-1', false],
    ]);
    expect(rss.addFeed).not.toHaveBeenCalled();
    expect(rss.removeFeed).not.toHaveBeenCalled();
  });

  it('removes only an allowlisted configured feed', async () => {
    const removed = storage({ removeFeed: vi.fn(() => true) });
    const success = interaction('remove', {
      url: 'https://news.example.com/feed.xml',
    });
    await handleRssCommand(success.value, deps(removed));
    expect(removed.removeFeed).toHaveBeenCalledWith(
      'server-1',
      'https://news.example.com/feed.xml',
    );
    expect(success.reply.mock.calls[0]?.[0]?.content).toMatch(/removed/i);

    const missing = storage({ removeFeed: vi.fn(() => false) });
    const absent = interaction('remove', {
      url: 'https://news.example.com/feed.xml',
    });
    await handleRssCommand(absent.value, deps(missing));
    expect(absent.reply.mock.calls[0]?.[0]?.content).toMatch(/not configured/i);
  });

  it('does not remove a feed whose host is off the allowlist', async () => {
    const rss = storage({ removeFeed: vi.fn(() => true) });
    const request = interaction('remove', {
      url: 'https://evil.example.net/feed.xml',
    });
    await handleRssCommand(request.value, deps(rss));
    expect(rss.removeFeed).not.toHaveBeenCalled();
    expect(request.reply.mock.calls[0]?.[0]?.content).toMatch(/allowlist/i);
  });

  it('rejects missing or oversized labels before adding a feed', async () => {
    const rss = storage();
    const blank = interaction('add', {
      url: 'https://news.example.com/feed.xml',
      label: '   ',
    });
    await handleRssCommand(blank.value, deps(rss));
    const oversized = interaction('add', {
      url: 'https://news.example.com/feed.xml',
      label: 'n'.repeat(81),
    });
    await handleRssCommand(oversized.value, deps(rss));
    expect(rss.addFeed).not.toHaveBeenCalled();
    expect(blank.reply.mock.calls[0]?.[0]?.content).toMatch(
      /label between 1 and 80/i,
    );
    expect(oversized.reply.mock.calls[0]?.[0]?.content).toMatch(
      /label between 1 and 80/i,
    );
  });

  it('rejects an unknown RSS action without mutating storage', async () => {
    const rss = storage();
    const request = interaction('rotate', {
      url: 'https://news.example.com/feed.xml',
      label: 'News',
    });
    await handleRssCommand(request.value, deps(rss));
    expect(rss.addFeed).not.toHaveBeenCalled();
    expect(rss.removeFeed).not.toHaveBeenCalled();
    expect(rss.setPaused).not.toHaveBeenCalled();
    expect(request.reply.mock.calls[0]?.[0]?.content).toMatch(/unknown rss/i);
  });
});
