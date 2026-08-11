import { describe, expect, it } from 'vitest';
import {
  startAdminConsole,
  type AdminConsoleSnapshot,
} from '../src/admin/admin-console.js';

describe('admin console', () => {
  it('serves a secret-free dashboard and JSON snapshot on localhost', async () => {
    const snapshot: AdminConsoleSnapshot = {
      platform: { version: '0.2.0', environment: 'test' },
      database: 'healthy',
      engagement: { enabled: true, features: ['introductions'] },
      providers: {
        ai: 'ollama',
        openAiConfigured: false,
        ollamaConfigured: true,
        webSearchConfigured: false,
      },
      integrations: { rss: 'ready', sleeper: false, github: false },
      metrics: { events: 2, failures: 0 },
      rss: {
        paused: false,
        feeds: [{ label: 'News', url: 'https://news.example/feed.xml' }],
      },
    };
    const console = await startAdminConsole({
      port: 0,
      snapshot: async () => snapshot,
    });
    const address = console.server.address();
    const port =
      typeof address === 'object' && address !== null ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/api/status`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(snapshot);
    const page = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    expect(page).toContain('Jarvis Command Deck');
    expect(page).toContain('controlBroadcast');
    expect(page).toContain('RSS preview');
    expect(page).toContain('saving establishes a baseline');
    expect(page).toContain('body.items.map');
    expect(page).not.toContain('api-key');
    await console.close();
  });

  it('has no write or unknown route', async () => {
    const console = await startAdminConsole({
      port: 0,
      snapshot: async () => ({
        platform: { version: 'x', environment: 'test' },
        database: 'healthy',
        engagement: { enabled: false, features: [] },
        providers: {
          ai: 'ollama',
          openAiConfigured: false,
          ollamaConfigured: false,
          webSearchConfigured: false,
        },
        integrations: { rss: 'not_configured', sleeper: false, github: false },
        metrics: null,
      }),
    });
    const address = console.server.address();
    const port =
      typeof address === 'object' && address !== null ? address.port : 0;
    expect(
      (await fetch(`http://127.0.0.1:${port}/`, { method: 'POST' })).status,
    ).toBe(404);
    await console.close();
  });

  it('previews an RSS feed only with the local admin token and never persists it', async () => {
    let previewedUrl = '';
    const console = await startAdminConsole({
      port: 0,
      snapshot: async () => ({
        platform: { version: 'x', environment: 'test' },
        database: 'healthy',
        engagement: { enabled: false, features: [] },
        providers: {
          ai: 'ollama',
          openAiConfigured: false,
          ollamaConfigured: false,
          webSearchConfigured: false,
        },
        integrations: { rss: 'ready', sleeper: false, github: false },
        metrics: null,
      }),
      rssControl: {
        token: 'secret',
        setPaused: async () => {},
        preview: async (url) => {
          previewedUrl = url;
          return Array.from({ length: 6 }, (_, index) => ({
            title: `Xbox update ${index + 1}`,
            url: `${url}/${index + 1}`,
            publishedAt: `2026-08-10T12:00:0${index}Z`,
          }));
        },
      },
    });
    const address = console.server.address();
    const port =
      typeof address === 'object' && address !== null ? address.port : 0;
    const endpoint = `http://127.0.0.1:${port}/api/rss/preview`;
    expect(
      (
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ url: 'https://news.example/feed.xml' }),
        })
      ).status,
    ).toBe(401);
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: 'Bearer secret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ url: 'https://news.example/feed.xml' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      url: 'https://news.example/feed.xml',
      items: [
        {
          title: 'Xbox update 1',
          url: 'https://news.example/feed.xml/1',
          publishedAt: '2026-08-10T12:00:00Z',
        },
        {
          title: 'Xbox update 2',
          url: 'https://news.example/feed.xml/2',
          publishedAt: '2026-08-10T12:00:01Z',
        },
        {
          title: 'Xbox update 3',
          url: 'https://news.example/feed.xml/3',
          publishedAt: '2026-08-10T12:00:02Z',
        },
        {
          title: 'Xbox update 4',
          url: 'https://news.example/feed.xml/4',
          publishedAt: '2026-08-10T12:00:03Z',
        },
        {
          title: 'Xbox update 5',
          url: 'https://news.example/feed.xml/5',
          publishedAt: '2026-08-10T12:00:04Z',
        },
      ],
    });
    expect(previewedUrl).toBe('https://news.example/feed.xml');
    await console.close();
  });

  it('marks RSS unavailable with actionable setup guidance', async () => {
    const console = await startAdminConsole({
      port: 0,
      snapshot: async () =>
        ({
          platform: { version: 'x', environment: 'test' },
          database: 'healthy',
          engagement: { enabled: false, features: [] },
          providers: {
            ai: 'ollama',
            openAiConfigured: false,
            ollamaConfigured: false,
            webSearchConfigured: false,
          },
          integrations: { rss: 'unavailable', sleeper: false, github: false },
          metrics: null,
        }) as unknown as AdminConsoleSnapshot,
    });
    const address = console.server.address();
    const port =
      typeof address === 'object' && address !== null ? address.port : 0;
    const page = await (await fetch(`http://127.0.0.1:${port}/`)).text();

    expect(page).toContain('RSS: unavailable (configure approved RSS hosts)');
    await console.close();
  });

  it('projects safe shipboard broadcast details without IDs or broadcast content', async () => {
    const console = await startAdminConsole({
      port: 0,
      snapshot: async () =>
        ({
          platform: { version: '0.5.0', environment: 'test' },
          database: 'healthy',
          engagement: { enabled: true, features: [] },
          providers: {
            ai: 'ollama',
            openAiConfigured: false,
            ollamaConfigured: true,
            webSearchConfigured: false,
          },
          integrations: { rss: 'ready', sleeper: false, github: false },
          metrics: { events: 2, failures: 0 },
          broadcasts: {
            categories: [
              {
                category: 'rss',
                label: 'RSS',
                state: 'enabled',
                destination: '#jarvis-updates',
                quietHours: '22:00 to 07:00 America/New_York',
                cadence: '1 hour',
                nextEligibleAt: '2026-08-11T17:00:00.000Z',
                lastAttemptAt: '2026-08-11T16:00:00.000Z',
                lastSuccessAt: '2026-08-11T16:00:01.000Z',
                errorCategory: 'network',
                health: 'ready',
              },
            ],
            last7Days: [
              { category: 'rss', eventName: 'delivery_succeeded', count: 2 },
            ],
            last30Days: [
              { category: 'rss', eventName: 'delivery_succeeded', count: 3 },
            ],
          },
          rawChannelId: '1536175231373148181',
          prompt: 'never show this source content',
        }) as unknown as AdminConsoleSnapshot,
    });
    const address = console.server.address();
    const port =
      typeof address === 'object' && address !== null ? address.port : 0;
    const page = await (await fetch(`http://127.0.0.1:${port}/`)).text();

    expect(page).toContain('#jarvis-updates');
    expect(page).toContain('Next eligible');
    expect(page).toContain('Last success');
    expect(page).toContain('delivery_succeeded');
    expect(page).not.toContain('1536175231373148181');
    expect(page).not.toContain('never show this source content');
    expect(page).not.toContain('guild');
    await console.close();
  });

  it('requires a short-lived single-use confirmation for an allowlisted broadcast state change', async () => {
    const writes: Array<{ category: string; state: string }> = [];
    let now = new Date('2026-08-11T16:00:00.000Z');
    const console = await startAdminConsole({
      port: 0,
      now: () => now,
      snapshot: async () => safeSnapshot(),
      broadcastControl: {
        token: 'local-token',
        allowedCategories: ['rss'],
        setState: async (category, state) => {
          writes.push({ category, state });
        },
      },
    });
    const address = console.server.address();
    const port =
      typeof address === 'object' && address !== null ? address.port : 0;
    const base = `http://127.0.0.1:${port}`;

    expect(
      (
        await fetch(`${base}/api/broadcast/rss/pause`, {
          method: 'POST',
          headers: { authorization: 'Bearer local-token' },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(`${base}/api/broadcast/recap/pause`, {
          method: 'POST',
          headers: { authorization: 'Bearer local-token' },
        })
      ).status,
    ).toBe(403);

    const confirmation = await fetch(`${base}/api/broadcast/rss/confirmation`, {
      method: 'POST',
      headers: { authorization: 'Bearer local-token' },
    });
    expect(confirmation.status).toBe(200);
    const { nonce } = (await confirmation.json()) as { nonce: string };
    const pause = () =>
      fetch(`${base}/api/broadcast/rss/pause`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer local-token',
          'x-confirmation-nonce': nonce,
        },
      });

    expect((await pause()).status).toBe(200);
    expect((await pause()).status).toBe(409);
    expect(writes).toEqual([{ category: 'rss', state: 'paused' }]);

    const expires = await fetch(`${base}/api/broadcast/rss/confirmation`, {
      method: 'POST',
      headers: { authorization: 'Bearer local-token' },
    });
    const { nonce: expiredNonce } = (await expires.json()) as { nonce: string };
    now = new Date(now.getTime() + 61_000);
    expect(
      (
        await fetch(`${base}/api/broadcast/rss/resume`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer local-token',
            'x-confirmation-nonce': expiredNonce,
          },
        })
      ).status,
    ).toBe(401);
    await console.close();
  });
});

function safeSnapshot(): AdminConsoleSnapshot {
  return {
    platform: { version: '0.5.0', environment: 'test' },
    database: 'healthy',
    engagement: { enabled: false, features: [] },
    providers: {
      ai: 'ollama',
      openAiConfigured: false,
      ollamaConfigured: false,
      webSearchConfigured: false,
    },
    integrations: { rss: 'ready', sleeper: false, github: false },
    metrics: null,
  };
}
