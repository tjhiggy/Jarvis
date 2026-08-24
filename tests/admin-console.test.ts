import { describe, expect, it } from 'vitest';
import { request as httpRequest } from 'node:http';
import { adminConsoleWorkflows } from '../src/admin/admin-console-workflows.js';
import {
  startAdminConsole,
  type AdminConsoleSnapshot,
} from '../src/admin/admin-console.js';
import { createCommandDeckMutationService } from '../src/admin/command-deck-mutations.js';

describe('admin console', () => {
  it('serves the authenticated, projected Command Deck snapshot with no-store headers', async () => {
    const console = await startAdminConsole({
      port: 0,
      snapshot: async () => basicSnapshot(),
      readApi: {
        token: 'dedicated-read-token-with-enough-entropy',
        allowedOrigins: [],
        maxClockSkewMs: 60_000,
        replayRetentionMs: 60_000,
        rateLimit: 30,
        rateWindowMs: 60_000,
      },
      now: () => new Date('2026-08-23T20:00:00.000Z'),
    });
    const endpoint = `${consoleUrl(console)}/api/v1/command-deck/snapshot`;
    const response = await fetch(endpoint, {
      headers: readHeaders('c248ad5f-1b62-4ed0-8caa-ab516cf9ea19'),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.json()).toMatchObject({
      schemaVersion: '1.0',
      observedAt: '2026-08-23T20:00:00.000Z',
      release: { version: '1.6.0', environment: 'test' },
      audit: { state: 'ready' },
    });
    await console.close();
  });

  it('returns versioned safe errors for unauthorized and unsupported read API requests', async () => {
    const console = await startAdminConsole({
      port: 0,
      snapshot: async () => basicSnapshot(),
      readApi: {
        token: 'dedicated-read-token-with-enough-entropy',
        allowedOrigins: [],
        maxClockSkewMs: 60_000,
        replayRetentionMs: 60_000,
        rateLimit: 30,
        rateWindowMs: 60_000,
      },
      now: () => new Date('2026-08-23T20:00:00.000Z'),
    });
    const endpoint = `${consoleUrl(console)}/api/v1/command-deck/snapshot`;

    const unauthorized = await fetch(endpoint, {
      headers: {
        ...readHeaders('c248ad5f-1b62-4ed0-8caa-ab516cf9ea19'),
        authorization: 'Bearer wrong',
      },
    });
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({
      schemaVersion: '1.0',
      observedAt: '2026-08-23T20:00:00.000Z',
      error: { code: 'unauthorized', message: 'Request denied.' },
    });

    const method = await fetch(endpoint, {
      method: 'POST',
      headers: readHeaders('624a631d-d623-42f9-ab52-613757c994fe'),
    });
    expect(method.status).toBe(405);
    expect(method.headers.get('allow')).toBe('GET');
    expect(await method.json()).toMatchObject({
      schemaVersion: '1.0',
      error: { code: 'method_not_allowed' },
    });
    await console.close();
  });

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
      intelligence: {
        approvedSources: 3,
        retainedSearch: 'ready',
        optedInMembers: 2,
        imageGeneration: 'disabled',
        localModel: 'gemma3:4b',
      },
      rss: {
        paused: false,
        feeds: [
          {
            label: 'News',
            url: 'https://operator:token@news.example/feed.xml?key=secret',
          },
        ],
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
    const statusBody = await response.text();
    expect(JSON.parse(statusBody)).toEqual({
      ...snapshot,
      rss: { paused: false },
    });
    expect(statusBody).not.toMatch(/operator|token|key=|feed\.xml/);
    const pageResponse = await fetch(`http://127.0.0.1:${port}/`);
    const page = await pageResponse.text();
    expect(page).toContain('Jarvis Command Deck');
    expect(page).toContain('aria-label="Command Deck navigation"');
    expect(page).toContain('data-view="overview"');
    for (const workflow of adminConsoleWorkflows) {
      expect(page).toContain(workflow.id);
    }
    expect(page).toContain('New transmission');
    expect(page).toContain('All systems nominal');
    expect(page).toContain('/assets/command-deck/jarvis-icon.png');
    expect(page).toContain('/assets/command-deck/bridge-banner.webp');
    expect(page).not.toContain('👑');
    expect(page).toContain('Community intelligence');
    expect(page).toContain('Approved sources: 3');
    expect(page).toContain('Opted-in members: 2');
    expect(page).toContain('gemma3:4b');
    expect(page).toContain('controlBroadcast');
    expect(page).toContain('RSS preview');
    expect(page).toContain('saving establishes a baseline');
    expect(page).toContain('body.items.map');
    expect(page).not.toContain('api-key');
    expect(pageResponse.headers.get('content-security-policy')).toContain(
      "default-src 'self'",
    );
    const iconResponse = await fetch(
      `http://127.0.0.1:${port}/assets/command-deck/jarvis-icon.png`,
    );
    expect(iconResponse.status).toBe(200);
    expect(iconResponse.headers.get('content-type')).toBe('image/png');
    const bannerResponse = await fetch(
      `http://127.0.0.1:${port}/assets/command-deck/bridge-banner.webp`,
    );
    expect(bannerResponse.status).toBe(200);
    expect(bannerResponse.headers.get('content-type')).toBe('image/webp');
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
      headers: {
        authorization: 'Bearer local-token',
        'x-broadcast-action': 'pause',
      },
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

    const triviaConfirmation = await fetch(
      `${base}/api/broadcast/trivia/confirmation`,
      {
        method: 'POST',
        headers: {
          authorization: 'Bearer local-token',
          'x-broadcast-action': 'pause',
        },
      },
    );
    expect(triviaConfirmation.status).toBe(403);

    const expires = await fetch(`${base}/api/broadcast/rss/confirmation`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer local-token',
        'x-broadcast-action': 'resume',
      },
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

  it('binds a confirmation nonce to its exact state change', async () => {
    const console = await startAdminConsole({
      port: 0,
      snapshot: async () => safeSnapshot(),
      broadcastControl: {
        token: 'local-token',
        allowedCategories: ['rss'],
        setState: async () => undefined,
      },
    });
    const address = console.server.address();
    const port =
      typeof address === 'object' && address !== null ? address.port : 0;
    const base = `http://127.0.0.1:${port}`;
    const confirmation = await fetch(`${base}/api/broadcast/rss/confirmation`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer local-token',
        'x-broadcast-action': 'pause',
      },
    });
    const { nonce } = (await confirmation.json()) as { nonce: string };
    expect(
      (
        await fetch(`${base}/api/broadcast/rss/resume`, {
          method: 'POST',
          headers: {
            authorization: 'Bearer local-token',
            'x-confirmation-nonce': nonce,
          },
        })
      ).status,
    ).toBe(401);
    await console.close();
  });

  it('previews and sends one allowlisted Command Deck broadcast with a single-use confirmation', async () => {
    const previews: Array<{ channelId: string; content: string }> = [];
    const confirmations: string[] = [];
    const console = await startAdminConsole({
      port: 0,
      snapshot: async () => safeSnapshot(),
      postControl: {
        token: 'local-token',
        channels: [{ id: 'channel-1', label: 'jarvis-testing' }],
        preview: async (input) => {
          previews.push(input);
          return {
            draftId: 'draft-1',
            destination: '#jarvis-testing',
            title: 'MuthaShip transmission',
            description: 'Crew update',
          };
        },
        confirm: async (draftId) => {
          confirmations.push(draftId);
          return { messageId: 'message-1' };
        },
        cancel: async () => true,
      },
    });
    const address = console.server.address();
    const port =
      typeof address === 'object' && address !== null ? address.port : 0;
    const base = `http://127.0.0.1:${port}`;

    const page = await (await fetch(`${base}/`)).text();
    expect(page).toContain('New transmission');
    expect(page).toContain('id="admin-token"');
    expect(page).toContain('jarvis-testing');
    expect(page).not.toContain('channel-1');
    expect(page).toContain('Public transmission preview');
    expect(page).toContain('Send transmission');
    expect(page).not.toContain("confirm('Send this public broadcast");

    expect(
      (
        await fetch(`${base}/api/post/preview`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            channelId: 'channel-1',
            content: 'Crew update',
          }),
        })
      ).status,
    ).toBe(401);

    const preview = await fetch(`${base}/api/post/preview`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer local-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ channelId: 'channel-1', content: 'Crew update' }),
    });
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as {
      draftId: string;
      confirmationNonce: string;
      destination: string;
      description: string;
    };
    expect(previewBody).toMatchObject({
      draftId: 'draft-1',
      destination: '#jarvis-testing',
      description: 'Crew update',
    });
    expect(previews).toEqual([
      { channelId: 'channel-1', content: 'Crew update' },
    ]);

    const confirm = () =>
      fetch(`${base}/api/post/confirm`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer local-token',
          'content-type': 'application/json',
          'x-confirmation-nonce': previewBody.confirmationNonce,
        },
        body: JSON.stringify({ draftId: previewBody.draftId }),
      });
    expect((await confirm()).status).toBe(200);
    expect((await confirm()).status).toBe(409);
    expect(confirmations).toEqual(['draft-1']);
    await console.close();
  });

  it('keeps a failed Command Deck broadcast confirmation retryable', async () => {
    let attempts = 0;
    const console = await startAdminConsole({
      port: 0,
      snapshot: async () => safeSnapshot(),
      postControl: {
        token: 'local-token',
        channels: [{ id: 'channel-1', label: 'jarvis-testing' }],
        preview: async () => ({
          draftId: 'draft-1',
          destination: '#jarvis-testing',
          title: 'MuthaShip transmission',
          description: 'Crew update',
        }),
        confirm: async () => {
          attempts += 1;
          if (attempts === 1) throw new Error('Discord unavailable');
          return { messageId: 'message-1' };
        },
        cancel: async () => true,
      },
    });
    const address = console.server.address();
    const port =
      typeof address === 'object' && address !== null ? address.port : 0;
    const base = `http://127.0.0.1:${port}`;
    const preview = await fetch(`${base}/api/post/preview`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer local-token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ channelId: 'channel-1', content: 'Crew update' }),
    });
    const previewBody = (await preview.json()) as {
      draftId: string;
      confirmationNonce: string;
    };
    const confirm = () =>
      fetch(`${base}/api/post/confirm`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer local-token',
          'content-type': 'application/json',
          'x-confirmation-nonce': previewBody.confirmationNonce,
        },
        body: JSON.stringify({ draftId: previewBody.draftId }),
      });
    expect((await confirm()).status).toBe(503);
    expect((await confirm()).status).toBe(200);
    expect(attempts).toBe(2);
    await console.close();
  });

  it('requires the shared boundary before exposing the bounded mutation catalog', async () => {
    const console = await startAdminConsole({
      port: 0,
      snapshot: async () => safeSnapshot(),
      readApi: mutationReadPolicy(),
      mutationApi: mutationApi(),
      now: () => new Date('2026-08-23T20:00:00.000Z'),
    });
    const endpoint = `${consoleUrl(console)}/api/v1/command-deck/config/catalog`;

    expect(
      (
        await fetch(endpoint, {
          headers: {
            'x-command-deck-request-id': 'c248ad5f-1b62-4ed0-8caa-ab516cf9ea19',
            'x-command-deck-timestamp': '2026-08-23T20:00:00.000Z',
          },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await fetch(endpoint, {
          headers: {
            ...mutationHeaders('c248ad5f-1b62-4ed0-8caa-ab516cf9ea19'),
            origin: 'https://evil.example',
          },
        })
      ).status,
    ).toBe(403);
    const allowed = await fetch(endpoint, {
      headers: mutationHeaders('624a631d-d623-42f9-ab52-613757c994fe'),
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({
      schemaVersion: '1.0',
      actions: {
        broadcastCategories: ['rss'],
        featureFlags: ['trivia'],
        rssHosts: ['feeds.example.test'],
      },
    });
    await console.close();
  });

  it('keeps mutation requests bounded, replay-safe, and receipt-driven', async () => {
    const applied: string[] = [];
    const console = await startAdminConsole({
      port: 0,
      snapshot: async () => safeSnapshot(),
      readApi: mutationReadPolicy(),
      mutationApi: mutationApi(applied),
      now: () => new Date('2026-08-23T20:00:00.000Z'),
    });
    const base = `${consoleUrl(console)}/api/v1/command-deck/config`;
    const preview = await fetch(`${base}/preview`, {
      method: 'POST',
      headers: {
        ...mutationHeaders('49526c45-163a-4624-864a-04214d9c6930'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action: { type: 'broadcast_state', category: 'rss', state: 'paused' },
      }),
    });
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as { preview: { id: string } };

    const nonJson = await fetch(`${base}/preview`, {
      method: 'POST',
      headers: {
        ...mutationHeaders('a19c1f52-30a7-4529-9ec9-19f6f7bc3425'),
        'content-type': 'text/plain',
      },
      body: JSON.stringify({
        action: { type: 'broadcast_state', category: 'rss', state: 'paused' },
      }),
    });
    expect(nonJson.status).toBe(400);

    const confirm = (requestId: string) =>
      fetch(`${base}/confirm`, {
        method: 'POST',
        headers: {
          ...mutationHeaders(requestId),
          'content-type': 'application/json',
          'idempotency-key': 'f2db1a0f-9461-43f0-a6e8-d6a699f431c7',
        },
        body: JSON.stringify({
          previewId: previewBody.preview.id,
          action: {
            type: 'broadcast_state',
            category: 'rss',
            state: 'paused',
          },
        }),
      });
    const first = await confirm('3d6c9e7b-b389-4eaf-90fe-3cc0ba4f8d8d');
    expect(first.status).toBe(200);
    const receipt = (await first.json()) as {
      receipt: { id: string; rollbackToken: string };
    };
    expect(receipt.receipt.rollbackToken).toBeTruthy();
    expect((await confirm('1bd6fca5-1b6b-4cd1-b45a-bc4b09220cd5')).status).toBe(
      200,
    );
    expect(applied).toEqual(['broadcast_state']);

    const rollbackPreview = await fetch(`${base}/rollback`, {
      method: 'POST',
      headers: {
        ...mutationHeaders('0d5b3c41-e5f6-4e88-a3d5-84e85bde8e63'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ rollbackToken: receipt.receipt.rollbackToken }),
    });
    expect(rollbackPreview.status).toBe(200);
    const rollbackBody = (await rollbackPreview.json()) as {
      preview: { id: string };
    };
    expect(
      (
        await fetch(`${base}/rollback`, {
          method: 'POST',
          headers: {
            ...mutationHeaders('ba5e1c9c-75af-4e9b-a1fe-94957fe9eb91'),
            'content-type': 'application/json',
            'idempotency-key': 'bec2450b-173b-4fde-81bb-6e248c07b5cd',
          },
          body: JSON.stringify({ previewId: rollbackBody.preview.id }),
        })
      ).status,
    ).toBe(200);
    expect(applied).toEqual(['broadcast_state', 'broadcast_state']);

    const oversized = await fetch(`${base}/preview`, {
      method: 'POST',
      headers: {
        ...mutationHeaders('7f7cf0ce-6c53-4904-9184-e40a77cb9a23'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        secretCanary: 'never-return-me',
        padding: 'x'.repeat(4_100),
      }),
    });
    expect(oversized.status).toBe(413);
    expect(await oversized.text()).not.toContain('never-return-me');

    const replay = await fetch(`${base}/cancel`, {
      method: 'POST',
      headers: {
        ...mutationHeaders('49526c45-163a-4624-864a-04214d9c6930'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ previewId: previewBody.preview.id }),
    });
    expect(replay.status).toBe(401);
    expect(await replay.json()).toMatchObject({
      error: { code: 'replayed_request', message: 'Request denied.' },
    });
    await console.close();
  });

  it('rejects catalog GET payloads before exposing configuration', async () => {
    const console = await startAdminConsole({
      port: 0,
      snapshot: async () => safeSnapshot(),
      readApi: mutationReadPolicy(),
      mutationApi: mutationApi(),
      now: () => new Date('2026-08-23T20:00:00.000Z'),
    });
    const endpoint = `${consoleUrl(console)}/api/v1/command-deck/config/catalog`;

    expect(
      (
        await rawRequest(
          endpoint,
          {
            ...mutationHeaders('c95ea6da-475e-4ca8-bae6-6b1f67718ca6'),
            'content-length': '1',
          },
          ['x'],
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await rawRequest(
          endpoint,
          {
            ...mutationHeaders('d0f6cbae-f5e2-4a0c-befd-fb62dac15f9a'),
            'transfer-encoding': 'chunked',
          },
          ['x'],
        )
      ).status,
    ).toBe(400);
    await console.close();
  });

  it('rejects JSON lookalike media types at the mutation boundary', async () => {
    const console = await startAdminConsole({
      port: 0,
      snapshot: async () => safeSnapshot(),
      readApi: mutationReadPolicy(),
      mutationApi: mutationApi(),
      now: () => new Date('2026-08-23T20:00:00.000Z'),
    });
    const response = await fetch(
      `${consoleUrl(console)}/api/v1/command-deck/config/preview`,
      {
        method: 'POST',
        headers: {
          ...mutationHeaders('64dc5c3d-bfdb-419e-866a-cf8b3c1b2edf'),
          'content-type': 'application/jsonp',
        },
        body: JSON.stringify({
          action: {
            type: 'broadcast_state',
            category: 'rss',
            state: 'paused',
          },
        }),
      },
    );

    expect(response.status).toBe(400);
    await console.close();
  });

  it('sanitizes unexpected mutation service failures', async () => {
    const api = mutationApi();
    const console = await startAdminConsole({
      port: 0,
      snapshot: async () => safeSnapshot(),
      readApi: mutationReadPolicy(),
      mutationApi: {
        ...api,
        service: {
          ...api.service,
          preview: async () => {
            throw new Error('canary-service-failure-must-not-leak');
          },
        },
      },
      now: () => new Date('2026-08-23T20:00:00.000Z'),
    });
    const response = await fetch(
      `${consoleUrl(console)}/api/v1/command-deck/config/preview`,
      {
        method: 'POST',
        headers: {
          ...mutationHeaders('2e535374-0aac-45d1-9b57-87139c314a45'),
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          action: {
            type: 'broadcast_state',
            category: 'rss',
            state: 'paused',
          },
        }),
      },
    );

    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('canary-service-failure');
    await console.close();
  });
});

function basicSnapshot(): AdminConsoleSnapshot {
  return {
    platform: { version: '1.6.0', environment: 'test' },
    database: 'healthy',
    engagement: { enabled: true, features: ['trivia'] },
    providers: {
      ai: 'ollama',
      openAiConfigured: false,
      ollamaConfigured: true,
      webSearchConfigured: false,
    },
    integrations: { rss: 'ready', sleeper: true, github: false },
    metrics: { events: 4, failures: 0 },
  };
}

function consoleUrl(console: Awaited<ReturnType<typeof startAdminConsole>>) {
  const address = console.server.address();
  const port =
    typeof address === 'object' && address !== null ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

function readHeaders(requestId: string): Record<string, string> {
  return {
    authorization: 'Bearer dedicated-read-token-with-enough-entropy',
    'x-command-deck-request-id': requestId,
    'x-command-deck-timestamp': '2026-08-23T20:00:00.000Z',
  };
}

function mutationHeaders(requestId: string): Record<string, string> {
  return {
    authorization: 'Bearer mutation-token-with-enough-entropy',
    'x-command-deck-request-id': requestId,
    'x-command-deck-timestamp': '2026-08-23T20:00:00.000Z',
  };
}

function mutationReadPolicy() {
  return {
    token: 'mutation-token-with-enough-entropy',
    allowedOrigins: [],
    maxClockSkewMs: 60_000,
    replayRetentionMs: 60_000,
    rateLimit: 30,
    rateWindowMs: 60_000,
  };
}

function mutationApi(applied: string[] = []) {
  let current = true;
  return {
    catalog: {
      broadcastCategories: ['rss'],
      featureFlags: ['trivia'],
      rssHosts: ['feeds.example.test'],
    },
    service: createCommandDeckMutationService({
      adapter: {
        allowedBroadcastCategories: ['rss'],
        supportedFeatureFlags: ['trivia'],
        allowedRssHosts: ['feeds.example.test'],
        read: async () => current,
        apply: async ({ action, nextValue }) => {
          applied.push(action.type);
          current = nextValue as boolean;
          return 'applied' as const;
        },
        operationStatus: async () => 'not_applied' as const,
        targetFor: (action) => `${action.type}:safe-target`,
      },
      createId: (() => {
        let sequence = 0;
        return () => `safe-id-${++sequence}`;
      })(),
    }),
  };
}

function rawRequest(
  url: string,
  headers: Record<string, string>,
  chunks: readonly string[],
): Promise<{ readonly status: number; readonly body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { method: 'GET', headers }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => (body += chunk));
      response.on('end', () =>
        resolve({ status: response.statusCode ?? 0, body }),
      );
    });
    request.on('error', reject);
    for (const chunk of chunks) request.write(chunk);
    request.end();
  });
}

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
