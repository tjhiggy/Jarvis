import { randomUUID } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { BroadcastCategory } from '../notifications/broadcast-policy.js';
import type {
  BroadcastDeliveryErrorCategory,
  BroadcastPolicyState,
} from '../notifications/broadcast-store.js';

type BroadcastRuntimeHealth = 'ready' | 'degraded' | 'unavailable';

export interface AdminConsoleBroadcastCategory {
  readonly category: BroadcastCategory;
  readonly label: string;
  readonly state: BroadcastPolicyState;
  readonly destination: string;
  readonly quietHours: string;
  readonly cadence: string;
  readonly nextEligibleAt?: string;
  readonly lastAttemptAt?: string;
  readonly lastSuccessAt?: string;
  readonly errorCategory?: BroadcastDeliveryErrorCategory;
  readonly health: BroadcastRuntimeHealth;
  readonly recovery?: string;
}

export interface AdminConsoleDeliverySummary {
  readonly category: BroadcastCategory;
  readonly eventName:
    | 'delivery_attempted'
    | 'delivery_succeeded'
    | 'delivery_failed'
    | 'delivery_suppressed'
    | 'delivery_retried';
  readonly count: number;
}

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
  readonly intelligence?: {
    readonly approvedSources: number;
    readonly retainedSearch: 'ready' | 'unavailable';
    readonly optedInMembers: number;
    readonly imageGeneration: 'ready' | 'disabled' | 'unavailable';
    readonly localModel: string;
  };
  readonly rss?:
    | {
        readonly paused: boolean;
        readonly feeds?: readonly {
          readonly label: string;
          readonly url: string;
        }[];
      }
    | undefined;
  readonly broadcasts?: {
    readonly categories: readonly AdminConsoleBroadcastCategory[];
    readonly last7Days: readonly AdminConsoleDeliverySummary[];
    readonly last30Days: readonly AdminConsoleDeliverySummary[];
  };
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

export interface AdminConsoleBroadcastControl {
  readonly token: string;
  readonly allowedCategories: readonly BroadcastCategory[];
  readonly setState: (
    category: BroadcastCategory,
    state: Extract<BroadcastPolicyState, 'enabled' | 'paused'>,
  ) => Promise<void>;
  readonly audit?: (entry: {
    readonly category: BroadcastCategory;
    readonly operation: 'pause' | 'resume';
    readonly occurredAt: Date;
  }) => Promise<void>;
}

export interface AdminConsolePostControl {
  readonly token: string;
  readonly channels: readonly { readonly id: string; readonly label: string }[];
  readonly preview: (input: {
    readonly channelId: string;
    readonly content: string;
  }) => Promise<{
    readonly draftId: string;
    readonly destination: string;
    readonly title: string;
    readonly description: string;
  }>;
  readonly confirm: (
    draftId: string,
  ) => Promise<{ readonly messageId: string }>;
  readonly cancel: (draftId: string) => Promise<boolean>;
  readonly audit?: (entry: {
    readonly operation: 'preview' | 'confirm' | 'cancel';
    readonly channelId: string;
    readonly outcome: 'succeeded' | 'failed';
    readonly occurredAt: Date;
  }) => Promise<void>;
}

const rssIntegrationStatus = (
  status: AdminConsoleSnapshot['integrations']['rss'],
): string => {
  if (status === 'ready') return 'ready';
  if (status === 'unavailable')
    return 'unavailable (configure approved RSS hosts)';
  return 'not configured';
};

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>'"]/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[
        character
      ]!,
  );

const renderBroadcastCards = (snapshot: AdminConsoleSnapshot): string => {
  const broadcasts = snapshot.broadcasts;
  if (broadcasts === undefined || broadcasts.categories.length === 0) {
    return '<article class="card"><h2>Shipboard Broadcasts</h2><p class="muted">No scheduled broadcasts are configured for this MuthaShip.</p></article>';
  }
  const summary = (
    days: number,
    rows: readonly AdminConsoleDeliverySummary[],
  ) =>
    rows.length === 0
      ? `<p class="muted">No delivery activity in the last ${days} days.</p>`
      : `<ul>${rows.map((row) => `<li>${escapeHtml(row.category)}: ${escapeHtml(row.eventName)} (${row.count})</li>`).join('')}</ul>`;
  return `<article class="card"><h2>Shipboard Broadcasts</h2>${broadcasts.categories
    .map(
      (category) =>
        `<section><h3>${escapeHtml(category.label)}</h3><p>State: ${escapeHtml(category.state)} · Destination: ${escapeHtml(category.destination)}</p><p>Quiet hours: ${escapeHtml(category.quietHours)} · Cadence: ${escapeHtml(category.cadence)}</p><p>Next eligible: ${escapeHtml(category.nextEligibleAt ?? 'not available')}</p><p>Last attempt: ${escapeHtml(category.lastAttemptAt ?? 'not available')} · Last success: ${escapeHtml(category.lastSuccessAt ?? 'not available')}</p><p>Health: ${escapeHtml(category.health)}${category.errorCategory === undefined ? '' : ` · Error: ${escapeHtml(category.errorCategory)}`}</p>${category.recovery === undefined ? '' : `<p class="muted">${escapeHtml(category.recovery)}</p>`}<button onclick="controlBroadcast('${category.category}','pause')">Pause</button><button onclick="controlBroadcast('${category.category}','resume')">Resume</button></section>`,
    )
    .join(
      '',
    )}<h3>Recent delivery metrics</h3><p>Last 7 days</p>${summary(7, broadcasts.last7Days)}<p>Last 30 days</p>${summary(30, broadcasts.last30Days)}</article>`;
};

const safeSnapshot = (
  snapshot: AdminConsoleSnapshot,
): AdminConsoleSnapshot => ({
  platform: snapshot.platform,
  database: snapshot.database,
  engagement: snapshot.engagement,
  providers: snapshot.providers,
  integrations: snapshot.integrations,
  metrics: snapshot.metrics,
  ...(snapshot.intelligence === undefined
    ? {}
    : { intelligence: snapshot.intelligence }),
  ...(snapshot.rss === undefined
    ? {}
    : { rss: { paused: snapshot.rss.paused } }),
  ...(snapshot.broadcasts === undefined
    ? {}
    : {
        broadcasts: {
          categories: snapshot.broadcasts.categories,
          last7Days: snapshot.broadcasts.last7Days,
          last30Days: snapshot.broadcasts.last30Days,
        },
      }),
});

const html = (
  snapshot: AdminConsoleSnapshot,
  postControl?: AdminConsolePostControl,
): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jarvis Command Deck</title><style>
:root{color-scheme:dark;--void:#090b17;--panel:#15182b;--panel2:#1d2038;--line:#3b3566;--gold:#f4c76b;--violet:#b89cff;--blue:#75b7ff;--text:#f5f2ff;--muted:#aeb2ca;--ok:#75e6ad}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 85% -10%,#33255c 0,#11152a 35%,var(--void) 72%);color:var(--text);font:16px system-ui,-apple-system,Segoe UI,sans-serif;min-height:100vh}main{max-width:1040px;margin:0 auto;padding:40px 24px 56px}header{display:flex;align-items:center;gap:16px;margin-bottom:28px}header .crest{font-size:38px;filter:drop-shadow(0 0 12px #9777ff88)}h1{margin:0;color:var(--gold);font-size:clamp(28px,5vw,42px);letter-spacing:.02em}h2{margin:0 0 12px;color:var(--violet);font-size:20px}.subtitle{margin:4px 0 0;color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(270px,1fr));gap:18px}.card{background:linear-gradient(145deg,#1d2038dd,#121528ee);border:1px solid var(--line);border-radius:16px;padding:20px;box-shadow:0 12px 34px #0006;transition:border-color .2s,transform .2s}.card:hover{border-color:#8069d9;transform:translateY(-2px)}.ok{color:var(--ok)}.muted{color:var(--muted)}ul{padding-left:20px}small{color:#8f94b2;overflow-wrap:anywhere}button{border:1px solid #6c5bc0;background:#332b68;color:var(--text);border-radius:8px;padding:9px 13px;font:inherit;cursor:pointer;margin:4px 6px 4px 0}button:hover,button:focus-visible{background:#5143a0;outline:2px solid var(--blue);outline-offset:2px}input{background:#0e1121;border:1px solid #514a7d;border-radius:8px;color:var(--text);padding:9px 10px;font:inherit;max-width:100%}@media(max-width:520px){main{padding:24px 16px 40px}.card{padding:16px}}
</style></head><body><main><header><span class="crest" aria-hidden="true">👑</span><div><h1>Jarvis Command Deck</h1><p class="subtitle">MuthaShip operations and broadcast control</p></div></header><p class="muted">Local operator console. Secrets stay local. Discord server settings remain out of scope.</p><section class="grid">
<article class="card"><h2>Platform</h2><p>Jarvis <strong>${snapshot.platform.version}</strong></p><p>${snapshot.platform.environment}</p><p class="ok">Database: ${snapshot.database}</p></article>
<article class="card"><h2>Community</h2><p>Engagement: <strong>${snapshot.engagement.enabled ? 'enabled' : 'disabled'}</strong></p><ul>${snapshot.engagement.features.map((feature) => `<li>${feature}</li>`).join('')}</ul></article>
<article class="card"><h2>Providers</h2><p>AI: ${snapshot.providers.ai}</p><p>OpenAI: ${snapshot.providers.openAiConfigured ? 'configured' : 'not configured'}</p><p>Ollama: ${snapshot.providers.ollamaConfigured ? 'configured' : 'not configured'}</p><p>Web search: ${snapshot.providers.webSearchConfigured ? 'configured' : 'not configured'}</p></article>
<article class="card"><h2>Integrations</h2><p>RSS: ${rssIntegrationStatus(snapshot.integrations.rss)}</p><p>Sleeper Fantasy Football: ${snapshot.integrations.sleeper ? 'ready' : 'not configured'}</p><p>GitHub read-only: ${snapshot.integrations.github ? 'ready' : 'not configured'}</p><p>Metrics: ${snapshot.metrics === null ? 'unavailable' : `${snapshot.metrics.events} events, ${snapshot.metrics.failures} failures`}</p></article>
${snapshot.intelligence === undefined ? '<article class="card"><h2>Community Intelligence</h2><p class="muted">Intelligence status is unavailable.</p></article>' : `<article class="card"><h2>Community Intelligence</h2><p>Approved sources: ${snapshot.intelligence.approvedSources}</p><p>Retained search: ${snapshot.intelligence.retainedSearch}</p><p>Opted-in members: ${snapshot.intelligence.optedInMembers}</p><p>Image generation: ${snapshot.intelligence.imageGeneration}</p><p>Local model: ${escapeHtml(snapshot.intelligence.localModel)}</p></article>`}
${renderBroadcastCards(snapshot)}
${
  postControl === undefined
    ? '<article class="card"><h2>New broadcast</h2><p class="muted">One-off broadcasts are unavailable.</p></article>'
    : `<article class="card"><h2>New broadcast</h2><p><label>Admin token <input id="admin-token" type="password" autocomplete="off" placeholder="Enter local admin token"></label></p><p><label>Destination <select id="post-channel">${postControl.channels.map((channel) => `<option value="${escapeHtml(channel.label)}">${escapeHtml(channel.label)}</option>`).join('')}</select></label></p><p><label>Message <textarea id="post-content" maxlength="1500" rows="6" placeholder="Compose a MuthaShip broadcast"></textarea></label></p><p><button onclick="previewPost()">Preview</button></p><pre id="post-result" class="muted"></pre></article>`
}
<article class="card"><h2>RSS preview</h2>${snapshot.rss ? `<p><input id="rss-url" placeholder="Allowlisted HTTPS feed URL"><button onclick="previewRss()">Preview feed</button></p><p id="rss-result" class="muted"></p>` : '<p class="muted">RSS preview is unavailable.</p>'}</article>
</section><p><small>Bound to localhost. Refresh for a current snapshot.</small></p></main><script>
function adminToken(){return document.getElementById('admin-token')?.value.trim()||'';}
async function controlBroadcast(category,action){if(!confirm('Confirm '+category+' '+action+' for this MuthaShip?'))return;const token=adminToken();if(!token){document.getElementById('rss-result').textContent='Enter the local admin token above first.';return;}const result=document.getElementById('rss-result');try{const confirmation=await fetch('/api/broadcast/'+category+'/confirmation',{method:'POST',headers:{Authorization:'Bearer '+token,'X-Broadcast-Action':action}});const confirmationBody=await confirmation.json();if(!confirmation.ok)throw new Error(confirmationBody.error||'Confirmation failed');const response=await fetch('/api/broadcast/'+category+'/'+action,{method:'POST',headers:{Authorization:'Bearer '+token,'X-Confirmation-Nonce':confirmationBody.nonce}});const body=await response.json();if(!response.ok)throw new Error(body.error||'Request failed');if(result)result.textContent=category+' '+action+'d successfully. Refreshing...';setTimeout(()=>location.reload(),300);}catch(error){if(result)result.textContent=error instanceof Error?error.message:'Broadcast control failed';}}
async function previewPost(){const token=adminToken();const channelId=document.getElementById('post-channel').value;const content=document.getElementById('post-content').value;const result=document.getElementById('post-result');if(!token){result.textContent='Enter the local admin token above first.';return;}if(!channelId||!content){result.textContent='Choose a destination and enter a message first.';return;}try{const preview=await fetch('/api/post/preview',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({channelId,content})});const body=await preview.json();if(!preview.ok)throw new Error(body.error||'Preview failed');result.textContent=body.title+'\\n'+body.destination+'\\n\\n'+body.description;if(!confirm('Send this public broadcast to '+body.destination+'?')){await fetch('/api/post/cancel',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-Confirmation-Nonce':body.confirmationNonce},body:JSON.stringify({draftId:body.draftId})});result.textContent='Broadcast cancelled.';return;}const sent=await fetch('/api/post/confirm',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-Confirmation-Nonce':body.confirmationNonce},body:JSON.stringify({draftId:body.draftId})});const sentBody=await sent.json();if(!sent.ok)throw new Error(sentBody.error||'Delivery failed');result.textContent='Broadcast sent successfully.';}catch(error){result.textContent=error instanceof Error?error.message:'Broadcast unavailable';}}
async function previewRss(){const token=adminToken();const url=document.getElementById('rss-url').value;if(!token){document.getElementById('rss-result').textContent='Enter the local admin token above first.';return;}if(!url){document.getElementById('rss-result').textContent='Enter a feed URL first.';return;}const result=document.getElementById('rss-result');try{const response=await fetch('/api/rss/preview',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({url})});const body=await response.json();if(!response.ok)throw new Error(body.error||'Preview failed');const entries=body.items.map((item)=>[item.title,item.url,item.publishedAt].join('\\n')).join('\\n\\n');result.textContent=body.items.length+' feed items found. No feed was saved; saving establishes a baseline, so historical entries are not posted.\\n\\n'+entries;}catch(error){result.textContent=error instanceof Error?error.message:'RSS preview failed';}}
</script></body></html>`;

export const startAdminConsole = (options: {
  readonly port: number;
  readonly host?: string;
  readonly snapshot: () => Promise<AdminConsoleSnapshot>;
  readonly rssControl?: AdminConsoleRssControl | undefined;
  readonly broadcastControl?: AdminConsoleBroadcastControl | undefined;
  readonly postControl?: AdminConsolePostControl | undefined;
  readonly now?: () => Date;
}): Promise<AdminConsole> => {
  const host = options.host ?? '127.0.0.1';
  const now = options.now ?? (() => new Date());
  const confirmations = new Map<
    string,
    {
      readonly category: BroadcastCategory;
      readonly action: 'pause' | 'resume';
      readonly expiresAt: number;
      used: boolean;
    }
  >();
  const postConfirmations = new Map<
    string,
    {
      readonly draftId: string;
      readonly channelId: string;
      readonly expiresAt: number;
      used: boolean;
    }
  >();
  const writeAuthorized = (request: IncomingMessage, token: string): boolean =>
    isLocalRequest(request) &&
    request.headers.authorization === `Bearer ${token}`;
  const writeJson = (
    response: ServerResponse,
    status: number,
    body: Record<string, unknown>,
  ): void => {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(JSON.stringify(body));
  };
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (
      request.method === 'POST' &&
      (path === '/api/post/preview' ||
        path === '/api/post/confirm' ||
        path === '/api/post/cancel')
    ) {
      const control = options.postControl;
      if (control === undefined || !writeAuthorized(request, control.token)) {
        writeJson(response, 401, { error: 'Unauthorized' });
        return;
      }
      let rawBody = '';
      for await (const chunk of request) {
        rawBody += chunk.toString();
        if (rawBody.length > 4096) break;
      }
      try {
        const body = JSON.parse(rawBody) as {
          channelId?: unknown;
          content?: unknown;
          draftId?: unknown;
        };
        if (path === '/api/post/preview') {
          const requestedChannel = String(body.channelId ?? '').trim();
          const channel = control.channels.find(
            (candidate) =>
              candidate.id === requestedChannel ||
              candidate.label === requestedChannel,
          );
          const content = String(body.content ?? '').trim();
          if (
            channel === undefined ||
            content === '' ||
            content.length > 1500
          ) {
            writeJson(response, 400, {
              error:
                'Choose an approved channel and enter up to 1500 characters.',
            });
            return;
          }
          const preview = await control.preview({
            channelId: channel.id,
            content,
          });
          const confirmationNonce = randomUUID();
          postConfirmations.set(confirmationNonce, {
            draftId: preview.draftId,
            channelId: channel.id,
            expiresAt: now().getTime() + 60_000,
            used: false,
          });
          await control.audit?.({
            operation: 'preview',
            channelId: channel.id,
            outcome: 'succeeded',
            occurredAt: now(),
          });
          writeJson(response, 200, { ...preview, confirmationNonce });
          return;
        }
        const draftId = String(body.draftId ?? '').trim();
        const nonce = request.headers['x-confirmation-nonce'];
        const confirmation =
          typeof nonce === 'string' ? postConfirmations.get(nonce) : undefined;
        if (
          confirmation === undefined ||
          confirmation.draftId !== draftId ||
          confirmation.expiresAt < now().getTime()
        ) {
          writeJson(response, 401, { error: 'Confirmation required.' });
          return;
        }
        if (confirmation.used) {
          writeJson(response, 409, {
            error: 'Confirmation has already been used.',
          });
          return;
        }
        confirmation.used = true;
        if (path === '/api/post/cancel') {
          const cancelled = await control.cancel(draftId);
          await control.audit?.({
            operation: 'cancel',
            channelId: confirmation.channelId,
            outcome: cancelled ? 'succeeded' : 'failed',
            occurredAt: now(),
          });
          writeJson(response, cancelled ? 200 : 404, { cancelled });
          return;
        }
        try {
          const sent = await control.confirm(draftId);
          await control.audit?.({
            operation: 'confirm',
            channelId: confirmation.channelId,
            outcome: 'succeeded',
            occurredAt: now(),
          });
          writeJson(response, 200, { ok: true, messageId: sent.messageId });
        } catch {
          confirmation.used = false;
          await control.audit?.({
            operation: 'confirm',
            channelId: confirmation.channelId,
            outcome: 'failed',
            occurredAt: now(),
          });
          writeJson(response, 503, {
            error:
              'Broadcast delivery is unavailable. The draft remains retryable.',
          });
        }
      } catch {
        writeJson(response, 503, {
          error:
            'Broadcast delivery is unavailable. The draft remains retryable.',
        });
      }
      return;
    }
    const broadcastMatch =
      /^\/api\/broadcast\/(rss|proactive|recap|event_reminder|birthday|trivia)\/(confirmation|pause|resume)$/.exec(
        path,
      );
    if (request.method === 'POST' && broadcastMatch !== null) {
      const [, category, action] = broadcastMatch as unknown as [
        string,
        BroadcastCategory,
        'confirmation' | 'pause' | 'resume',
      ];
      const control = options.broadcastControl;
      if (control === undefined || !writeAuthorized(request, control.token)) {
        writeJson(response, 401, { error: 'Unauthorized' });
        return;
      }
      if (!control.allowedCategories.includes(category)) {
        writeJson(response, 403, {
          error: 'Category is not configured for this MuthaShip.',
        });
        return;
      }
      if (action === 'confirmation') {
        const requestedAction = request.headers['x-broadcast-action'];
        if (requestedAction !== 'pause' && requestedAction !== 'resume') {
          writeJson(response, 400, {
            error: 'Confirmation action is required.',
          });
          return;
        }
        const nonce = randomUUID();
        confirmations.set(nonce, {
          category,
          action: requestedAction,
          expiresAt: now().getTime() + 60_000,
          used: false,
        });
        writeJson(response, 200, { nonce });
        return;
      }
      const nonce = request.headers['x-confirmation-nonce'];
      const confirmation =
        typeof nonce === 'string' ? confirmations.get(nonce) : undefined;
      if (
        confirmation === undefined ||
        confirmation.category !== category ||
        confirmation.action !== action ||
        confirmation.expiresAt < now().getTime()
      ) {
        writeJson(response, 401, { error: 'Confirmation required.' });
        return;
      }
      if (confirmation.used) {
        writeJson(response, 409, {
          error: 'Confirmation has already been used.',
        });
        return;
      }
      confirmation.used = true;
      try {
        await control.setState(
          category,
          action === 'pause' ? 'paused' : 'enabled',
        );
        await control.audit?.({
          category,
          operation: action,
          occurredAt: now(),
        });
        writeJson(response, 200, {
          ok: true,
          category,
          state: action === 'pause' ? 'paused' : 'enabled',
        });
      } catch {
        writeJson(response, 503, { error: 'Broadcast control unavailable.' });
      }
      return;
    }
    if (request.method === 'POST' && request.url === '/api/rss/preview') {
      if (
        options.rssControl?.preview === undefined ||
        !writeAuthorized(request, options.rssControl.token)
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
      request.method !== 'GET' ||
      (request.url !== '/' && request.url !== '/api/status')
    ) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    try {
      const snapshot = safeSnapshot(await options.snapshot());
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
      response.end(html(snapshot, options.postControl));
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

const isLocalRequest = (request: IncomingMessage): boolean =>
  request.socket.remoteAddress === '127.0.0.1' ||
  request.socket.remoteAddress === '::1' ||
  request.socket.remoteAddress === '::ffff:127.0.0.1';
