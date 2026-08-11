import { describe, expect, it } from 'vitest';
import { startAdminConsole, type AdminConsoleSnapshot } from '../src/admin/admin-console.js';

describe('admin console', () => {
  it('serves a secret-free dashboard and JSON snapshot on localhost', async () => {
    const snapshot: AdminConsoleSnapshot = {
      platform: { version: '0.2.0', environment: 'test' }, database: 'healthy',
      engagement: { enabled: true, features: ['introductions'] },
      providers: { ai: 'ollama', openAiConfigured: false, ollamaConfigured: true, webSearchConfigured: false },
      integrations: { rss: true, sleeper: false, github: false }, metrics: { events: 2, failures: 0 },
      rss: { paused: false, feeds: [{ label: 'News', url: 'https://news.example/feed.xml' }] },
    };
    const console = await startAdminConsole({ port: 0, snapshot: async () => snapshot });
    const address = console.server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const response = await fetch(`http://127.0.0.1:${port}/api/status`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(snapshot);
    const page = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    expect(page).toContain('Jarvis Command Deck');
    expect(page).toContain('controlRss');
    expect(page).toContain('Pause');
    expect(page).not.toContain('api-key');
    await console.close();
  });

  it('has no write or unknown route', async () => {
    const console = await startAdminConsole({ port: 0, snapshot: async () => ({ platform: { version: 'x', environment: 'test' }, database: 'healthy', engagement: { enabled: false, features: [] }, providers: { ai: 'ollama', openAiConfigured: false, ollamaConfigured: false, webSearchConfigured: false }, integrations: { rss: false, sleeper: false, github: false }, metrics: null }) });
    const address = console.server.address(); const port = typeof address === 'object' && address !== null ? address.port : 0;
    expect((await fetch(`http://127.0.0.1:${port}/`, { method: 'POST' })).status).toBe(404);
    await console.close();
  });
});
