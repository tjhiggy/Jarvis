import { createServer, type Server } from 'node:http';

export interface AdminConsoleSnapshot {
  readonly platform: { readonly version: string; readonly environment: string };
  readonly database: 'healthy' | 'unavailable';
  readonly engagement: { readonly enabled: boolean; readonly features: readonly string[] };
  readonly providers: { readonly ai: string; readonly openAiConfigured: boolean; readonly ollamaConfigured: boolean; readonly webSearchConfigured: boolean };
  readonly integrations: { readonly rss: boolean; readonly sleeper: boolean; readonly github: boolean };
  readonly metrics: { readonly events: number; readonly failures: number } | null;
  readonly rss?: { readonly paused: boolean; readonly feeds: readonly { readonly label: string; readonly url: string }[] } | undefined;
}

export interface AdminConsole {
  readonly server: Server;
  readonly close: () => Promise<void>;
}

export interface AdminConsoleRssControl {
  readonly token: string;
  readonly setPaused: (paused: boolean) => Promise<void>;
}

const html = (snapshot: AdminConsoleSnapshot): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jarvis Command Deck</title><style>
body{margin:0;background:#0d1020;color:#f5f2ff;font:16px system-ui,sans-serif}main{max-width:980px;margin:0 auto;padding:32px}h1{color:#f4c76b}h2{margin:0 0 12px;color:#b89cff}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}.card{background:#171b31;border:1px solid #35395c;border-radius:14px;padding:20px;box-shadow:0 8px 30px #0003}.ok{color:#75e6ad}.muted{color:#aeb2ca}ul{padding-left:20px}small{color:#8f94b2}
</style></head><body><main><h1>🚀 Jarvis Command Deck</h1><p class="muted">Local read-only operations view. No secrets. No server-setting controls.</p><section class="grid">
<article class="card"><h2>Platform</h2><p>Jarvis <strong>${snapshot.platform.version}</strong></p><p>${snapshot.platform.environment}</p><p class="ok">Database: ${snapshot.database}</p></article>
<article class="card"><h2>Community</h2><p>Engagement: <strong>${snapshot.engagement.enabled ? 'enabled' : 'disabled'}</strong></p><ul>${snapshot.engagement.features.map((feature) => `<li>${feature}</li>`).join('')}</ul></article>
<article class="card"><h2>Providers</h2><p>AI: ${snapshot.providers.ai}</p><p>OpenAI: ${snapshot.providers.openAiConfigured ? 'configured' : 'not configured'}</p><p>Ollama: ${snapshot.providers.ollamaConfigured ? 'configured' : 'not configured'}</p><p>Web search: ${snapshot.providers.webSearchConfigured ? 'configured' : 'not configured'}</p></article>
<article class="card"><h2>Integrations</h2><p>RSS: ${snapshot.integrations.rss ? 'ready' : 'not configured'}</p><p>Sleeper Fantasy Football: ${snapshot.integrations.sleeper ? 'ready' : 'not configured'}</p><p>GitHub read-only: ${snapshot.integrations.github ? 'ready' : 'not configured'}</p><p>Metrics: ${snapshot.metrics === null ? 'unavailable' : `${snapshot.metrics.events} events, ${snapshot.metrics.failures} failures`}</p></article>
<article class="card"><h2>Shipboard Broadcasts</h2><p>RSS: ${snapshot.rss?.paused ? 'paused' : snapshot.rss ? 'active' : 'not configured'}</p>${snapshot.rss ? `<ul>${snapshot.rss.feeds.map((feed) => `<li>${feed.label} <small>${feed.url}</small></li>`).join('')}</ul><button onclick="controlRss('pause')">Pause</button><button onclick="controlRss('resume')">Resume</button><p id="rss-result" class="muted"></p>` : ''}</article>
</section><p><small>Bound to localhost. Refresh for a current snapshot.</small></p></main><script>
async function controlRss(action){if(!confirm('Confirm RSS '+action+' for this MuthaShip?'))return;const token=prompt('Enter the local Admin Console token:');if(!token)return;const result=document.getElementById('rss-result');try{const response=await fetch('/api/rss/'+action,{method:'POST',headers:{Authorization:'Bearer '+token}});const body=await response.json();if(!response.ok)throw new Error(body.error||'Request failed');result.textContent='RSS '+action+'d successfully. Refreshing...';setTimeout(()=>location.reload(),300);}catch(error){result.textContent=error instanceof Error?error.message:'RSS control failed';}}
</script></body></html>`;

export const startAdminConsole = (options: {
  readonly port: number;
  readonly host?: string;
  readonly snapshot: () => Promise<AdminConsoleSnapshot>;
  readonly rssControl?: AdminConsoleRssControl | undefined;
}): Promise<AdminConsole> => {
  const host = options.host ?? '127.0.0.1';
  const server = createServer(async (request, response) => {
    if (request.method === 'POST' && (request.url === '/api/rss/pause' || request.url === '/api/rss/resume')) {
      if (options.rssControl === undefined || request.headers.authorization !== `Bearer ${options.rssControl.token}`) {
        response.writeHead(401, { 'content-type': 'application/json; charset=utf-8' }); response.end(JSON.stringify({ error: 'Unauthorized' })); return;
      }
      try {
        await options.rssControl.setPaused(request.url.endsWith('/pause'));
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify({ ok: true, paused: request.url.endsWith('/pause') }));
      } catch { response.writeHead(503, { 'content-type': 'application/json; charset=utf-8' }); response.end(JSON.stringify({ error: 'RSS control unavailable' })); }
      return;
    }
    if (request.method !== 'GET' || (request.url !== '/' && request.url !== '/api/status')) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); response.end('Not found'); return;
    }
    try {
      const snapshot = await options.snapshot();
      if (request.url === '/api/status') {
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(snapshot)); return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); response.end(html(snapshot));
    } catch {
      response.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify({ error: 'Command Deck unavailable' }));
    }
  });
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve({ server, close: () => new Promise<void>((done) => server.close(() => done())) }); };
    server.once('error', onError); server.once('listening', onListening); server.listen(options.port, host);
  });
};
