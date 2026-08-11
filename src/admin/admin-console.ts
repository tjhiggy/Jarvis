import { createServer, type Server } from 'node:http';

export interface AdminConsoleSnapshot {
  readonly platform: { readonly version: string; readonly environment: string };
  readonly database: 'healthy' | 'unavailable';
  readonly engagement: {
    readonly enabled: boolean;
    readonly features: readonly string[];
  };
  readonly providers: {
    readonly ai: string;
    readonly openAiConfigured: boolean;
    readonly ollamaConfigured: boolean;
    readonly webSearchConfigured: boolean;
  };
  readonly integrations: {
    readonly rss: 'ready' | 'unavailable' | 'not_configured';
    readonly sleeper: boolean;
    readonly github: boolean;
  };
  readonly metrics: {
    readonly events: number;
    readonly failures: number;
  } | null;
  readonly rss?:
    | {
        readonly paused: boolean;
        readonly feeds: readonly {
          readonly label: string;
          readonly url: string;
        }[];
      }
    | undefined;
}

export interface AdminConsole {
  readonly server: Server;
  readonly close: () => Promise<void>;
}

export interface AdminConsoleRssControl {
  readonly token: string;
  readonly setPaused: (paused: boolean) => Promise<void>;
  readonly preview?: (url: string) => Promise<
    readonly {
      readonly title: string;
      readonly url: string;
      readonly publishedAt: string;
    }[]
  >;
}

const rssIntegrationStatus = (
  status: AdminConsoleSnapshot['integrations']['rss'],
): string => {
  if (status === 'ready') return 'ready';
  if (status === 'unavailable')
    return 'unavailable (configure approved RSS hosts)';
  return 'not configured';
};

const html = (snapshot: AdminConsoleSnapshot): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jarvis Command Deck</title><style>
:root{color-scheme:dark;--void:#090b17;--panel:#15182b;--panel2:#1d2038;--line:#3b3566;--gold:#f4c76b;--violet:#b89cff;--blue:#75b7ff;--text:#f5f2ff;--muted:#aeb2ca;--ok:#75e6ad}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 85% -10%,#33255c 0,#11152a 35%,var(--void) 72%);color:var(--text);font:16px system-ui,-apple-system,Segoe UI,sans-serif;min-height:100vh}main{max-width:1040px;margin:0 auto;padding:40px 24px 56px}header{display:flex;align-items:center;gap:16px;margin-bottom:28px}header .crest{font-size:38px;filter:drop-shadow(0 0 12px #9777ff88)}h1{margin:0;color:var(--gold);font-size:clamp(28px,5vw,42px);letter-spacing:.02em}h2{margin:0 0 12px;color:var(--violet);font-size:20px}.subtitle{margin:4px 0 0;color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:18px}.card{background:linear-gradient(145deg,#1d2038dd,#121528ee);border:1px solid var(--line);border-radius:16px;padding:20px;box-shadow:0 12px 34px #0006;transition:border-color .2s,transform .2s}.card:hover{border-color:#8069d9;transform:translateY(-2px)}.ok{color:var(--ok)}.muted{color:var(--muted)}ul{padding-left:20px}small{color:#8f94b2;overflow-wrap:anywhere}button{border:1px solid #6c5bc0;background:#332b68;color:var(--text);border-radius:8px;padding:9px 13px;font:inherit;cursor:pointer;margin:4px 6px 4px 0}button:hover,button:focus-visible{background:#5143a0;outline:2px solid var(--blue);outline-offset:2px}input{background:#0e1121;border:1px solid #514a7d;border-radius:8px;color:var(--text);padding:9px 10px;font:inherit;max-width:100%}@media(max-width:520px){main{padding:24px 16px 40px}.card{padding:16px}}
</style></head><body><main><header><span class="crest" aria-hidden="true">👑</span><div><h1>Jarvis Command Deck</h1><p class="subtitle">MuthaShip operations and broadcast control</p></div></header><p class="muted">Local operator console. Secrets stay local. Discord server settings remain out of scope.</p><section class="grid">
<article class="card"><h2>Platform</h2><p>Jarvis <strong>${snapshot.platform.version}</strong></p><p>${snapshot.platform.environment}</p><p class="ok">Database: ${snapshot.database}</p></article>
<article class="card"><h2>Community</h2><p>Engagement: <strong>${snapshot.engagement.enabled ? 'enabled' : 'disabled'}</strong></p><ul>${snapshot.engagement.features.map((feature) => `<li>${feature}</li>`).join('')}</ul></article>
<article class="card"><h2>Providers</h2><p>AI: ${snapshot.providers.ai}</p><p>OpenAI: ${snapshot.providers.openAiConfigured ? 'configured' : 'not configured'}</p><p>Ollama: ${snapshot.providers.ollamaConfigured ? 'configured' : 'not configured'}</p><p>Web search: ${snapshot.providers.webSearchConfigured ? 'configured' : 'not configured'}</p></article>
<article class="card"><h2>Integrations</h2><p>RSS: ${rssIntegrationStatus(snapshot.integrations.rss)}</p><p>Sleeper Fantasy Football: ${snapshot.integrations.sleeper ? 'ready' : 'not configured'}</p><p>GitHub read-only: ${snapshot.integrations.github ? 'ready' : 'not configured'}</p><p>Metrics: ${snapshot.metrics === null ? 'unavailable' : `${snapshot.metrics.events} events, ${snapshot.metrics.failures} failures`}</p></article>
<article class="card"><h2>Shipboard Broadcasts</h2><p>RSS: ${snapshot.rss?.paused ? 'paused' : snapshot.rss ? 'active' : 'not configured'}</p>${snapshot.rss ? `<ul>${snapshot.rss.feeds.map((feed) => `<li>${feed.label} <small>${feed.url}</small></li>`).join('')}</ul><button onclick="controlRss('pause')">Pause</button><button onclick="controlRss('resume')">Resume</button><p><input id="rss-url" placeholder="Allowlisted HTTPS feed URL"><button onclick="previewRss()">Preview feed</button></p><p id="rss-result" class="muted"></p>` : ''}</article>
</section><p><small>Bound to localhost. Refresh for a current snapshot.</small></p></main><script>
async function controlRss(action){if(!confirm('Confirm RSS '+action+' for this MuthaShip?'))return;const token=prompt('Enter the local Admin Console token:');if(!token)return;const result=document.getElementById('rss-result');try{const response=await fetch('/api/rss/'+action,{method:'POST',headers:{Authorization:'Bearer '+token}});const body=await response.json();if(!response.ok)throw new Error(body.error||'Request failed');result.textContent='RSS '+action+'d successfully. Refreshing...';setTimeout(()=>location.reload(),300);}catch(error){result.textContent=error instanceof Error?error.message:'RSS control failed';}}
async function previewRss(){const token=prompt('Enter the local Admin Console token:');const url=document.getElementById('rss-url').value;if(!token||!url)return;const result=document.getElementById('rss-result');try{const response=await fetch('/api/rss/preview',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({url})});const body=await response.json();if(!response.ok)throw new Error(body.error||'Preview failed');const entries=body.items.map((item)=>[item.title,item.url,item.publishedAt].join('\n')).join('\n\n');result.textContent=body.items.length+' feed items found. No feed was saved; saving establishes a baseline, so historical entries are not posted.\n\n'+entries;}catch(error){result.textContent=error instanceof Error?error.message:'RSS preview failed';}}
</script></body></html>`;

export const startAdminConsole = (options: {
  readonly port: number;
  readonly host?: string;
  readonly snapshot: () => Promise<AdminConsoleSnapshot>;
  readonly rssControl?: AdminConsoleRssControl | undefined;
}): Promise<AdminConsole> => {
  const host = options.host ?? '127.0.0.1';
  const server = createServer(async (request, response) => {
    if (request.method === 'POST' && request.url === '/api/rss/preview') {
      if (
        options.rssControl?.preview === undefined ||
        request.headers.authorization !== `Bearer ${options.rssControl.token}`
      ) {
        response.writeHead(401, {
          'content-type': 'application/json; charset=utf-8',
        });
        response.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      let body = '';
      for await (const chunk of request) {
        body += chunk.toString();
        if (body.length > 2048) break;
      }
      try {
        const url = String(
          (JSON.parse(body) as { url?: unknown }).url ?? '',
        ).trim();
        const items = await options.rssControl.preview(url);
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end(JSON.stringify({ url, items: items.slice(0, 5) }));
      } catch {
        response.writeHead(400, {
          'content-type': 'application/json; charset=utf-8',
        });
        response.end(
          JSON.stringify({
            error: 'RSS preview unavailable. Check the allowlist and feed URL.',
          }),
        );
      }
      return;
    }
    if (
      request.method === 'POST' &&
      (request.url === '/api/rss/pause' || request.url === '/api/rss/resume')
    ) {
      if (
        options.rssControl === undefined ||
        request.headers.authorization !== `Bearer ${options.rssControl.token}`
      ) {
        response.writeHead(401, {
          'content-type': 'application/json; charset=utf-8',
        });
        response.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      try {
        await options.rssControl.setPaused(request.url.endsWith('/pause'));
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end(
          JSON.stringify({ ok: true, paused: request.url.endsWith('/pause') }),
        );
      } catch {
        response.writeHead(503, {
          'content-type': 'application/json; charset=utf-8',
        });
        response.end(JSON.stringify({ error: 'RSS control unavailable' }));
      }
      return;
    }
    if (
      request.method !== 'GET' ||
      (request.url !== '/' && request.url !== '/api/status')
    ) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    try {
      const snapshot = await options.snapshot();
      if (request.url === '/api/status') {
        response.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        response.end(JSON.stringify(snapshot));
        return;
      }
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(html(snapshot));
    } catch {
      response.writeHead(503, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      response.end(JSON.stringify({ error: 'Command Deck unavailable' }));
    }
  });
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve({
        server,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(options.port, host);
  });
};
