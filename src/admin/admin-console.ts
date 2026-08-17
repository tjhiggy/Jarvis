import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { resolve } from 'node:path';
import type { BroadcastCategory } from '../notifications/broadcast-policy.js';
import type {
  BroadcastDeliveryErrorCategory,
  BroadcastPolicyState,
} from '../notifications/broadcast-store.js';
import { buildAdminObservabilityProjection } from './observability.js';

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
        `<section class="broadcast-row"><div><h3>${escapeHtml(category.label)}</h3><p><span class="status status-${escapeHtml(category.health)}">${escapeHtml(category.health)}</span> ${escapeHtml(category.state)} · ${escapeHtml(category.destination)}</p><p class="muted">Quiet hours: ${escapeHtml(category.quietHours)} · Cadence: ${escapeHtml(category.cadence)}</p><p class="muted">Next eligible: ${escapeHtml(category.nextEligibleAt ?? 'not available')}</p><p class="muted">Last attempt: ${escapeHtml(category.lastAttemptAt ?? 'not available')} · Last success: ${escapeHtml(category.lastSuccessAt ?? 'not available')}</p>${category.recovery === undefined ? '' : `<p class="muted">${escapeHtml(category.recovery)}</p>`}</div><div class="row-actions"><button class="secondary broadcast-action" data-category="${category.category}" data-action="pause" type="button">Pause</button><button class="secondary broadcast-action" data-category="${category.category}" data-action="resume" type="button">Resume</button></div></section>`,
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
  nonce = '',
): string => {
  const projection = buildAdminObservabilityProjection({
    metrics: snapshot.metrics,
    database: snapshot.database,
    configuredFeatures: snapshot.engagement.features,
    configuredIntegrations: [
      snapshot.integrations.rss !== 'not_configured',
      snapshot.integrations.sleeper,
      snapshot.integrations.github,
    ].filter(Boolean).length,
    totalIntegrations: 3,
  });
  const healthy =
    snapshot.database === 'healthy' && projection.health === 'healthy';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jarvis Command Deck</title><style nonce="${nonce}">
:root{color-scheme:dark;--void:#070611;--hull:#151126;--raised:#21183b;--line:#5d3aa3;--gold:#f6c85f;--violet:#c09cff;--blue:#78c8ff;--text:#faf7ff;--muted:#b8b0cc;--ok:#72efb0;--warn:#ffcf70;--bad:#ff7e96}*{box-sizing:border-box}body{margin:0;background:var(--void);color:var(--text);font:15px Inter,system-ui,-apple-system,Segoe UI,sans-serif;min-height:100vh}.shell{display:grid;grid-template-columns:250px 1fr;min-height:100vh}.sidebar{position:sticky;top:0;height:100vh;padding:28px 18px;background:#090713;border-right:1px solid #302249}.brand{display:flex;gap:12px;align-items:center;padding:0 8px 28px}.brand img{width:48px;height:48px;border-radius:50%;box-shadow:0 0 24px #9c65ff88}.brand strong{display:block;color:var(--gold);font-size:18px;letter-spacing:.08em}.eyebrow,.nav-label{color:#9e8bbd;text-transform:uppercase;letter-spacing:.16em;font-size:11px;font-weight:800}.nav{display:grid;gap:7px}.nav button{width:100%;text-align:left;background:transparent;border:1px solid transparent;color:var(--muted);padding:11px 13px}.nav button[aria-current="page"]{color:var(--text);background:#241940;border-color:#6f4da3;box-shadow:inset 3px 0 var(--gold)}.sidebar-foot{position:absolute;bottom:24px;left:26px;color:#817592}.content{min-width:0}.hero{position:relative;isolation:isolate;min-height:245px;padding:42px 48px 32px;background:linear-gradient(90deg,#090713 4%,#0a0715aa 48%,#070611ee),url('/assets/command-deck/bridge-banner.webp') center/cover}.hero:after{content:"";position:absolute;inset:auto 0 0;height:1px;background:linear-gradient(90deg,transparent,var(--gold),transparent);opacity:.6}.hero-row{display:flex;justify-content:space-between;align-items:flex-end;gap:24px}.hero h1{margin:8px 0 8px;font-size:clamp(34px,5vw,58px);letter-spacing:.025em;line-height:1;color:#fff}.hero p{max-width:650px;color:#c6bad8;font-size:17px}.primary,.secondary,.nav button{font:inherit;border-radius:8px;cursor:pointer}.primary{background:linear-gradient(135deg,#7c4dd0,#a66cff);border:1px solid #c6a2ff;color:white;padding:12px 18px;font-weight:800;box-shadow:0 0 24px #865de055}.secondary{background:#241940;border:1px solid #68459a;color:var(--text);padding:9px 13px}.primary:focus-visible,.secondary:focus-visible,.nav button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:3px solid var(--blue);outline-offset:3px}.mobile-nav{display:none}.workspace{max-width:1280px;margin:0 auto;padding:28px 38px 60px}.health-banner{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:20px;padding:17px 20px;background:linear-gradient(90deg,#123226aa,#151126);border:1px solid #2f7f61;border-radius:12px}.health-banner strong{color:var(--ok);font-size:17px}.status{display:inline-flex;align-items:center;gap:7px;padding:4px 9px;border:1px solid #4c3a6c;border-radius:999px;font-size:12px;text-transform:uppercase;letter-spacing:.08em}.status:before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}.status-healthy{color:var(--ok)}.status-degraded,.status-warning{color:var(--warn)}.status-unavailable,.status-error{color:var(--bad)}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:18px 0}.card{background:linear-gradient(145deg,#1e1634,#100d1d);border:1px solid #3e2b5f;border-radius:12px;padding:20px;box-shadow:0 14px 36px #0005}.kpi strong{display:block;margin-top:8px;font-size:28px;color:#fff}.kpi span{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.wide{grid-column:1/-1}.card h2{margin:0 0 16px;color:var(--violet);font-size:20px}.card h3{margin:0 0 6px}.muted{color:var(--muted)}.view[hidden]{display:none}.activity{list-style:none;padding:0;margin:0}.activity li,.broadcast-row{display:flex;justify-content:space-between;gap:20px;padding:13px 0;border-top:1px solid #2e2342}.activity li:first-child{border-top:0}.row-actions{white-space:nowrap}label{display:grid;gap:7px;margin:12px 0;color:#d8cee8;font-weight:650}input,select,textarea{width:100%;background:#0c0915;border:1px solid #62458d;border-radius:8px;color:var(--text);padding:10px 12px;font:inherit}textarea{resize:vertical}.form-grid{display:grid;grid-template-columns:220px 1fr;gap:14px}.result{white-space:pre-wrap;overflow-wrap:anywhere;background:#0b0813;border:1px solid #35264e;border-radius:8px;padding:13px;min-height:46px}.preview-card{border-left:3px solid var(--gold);padding:16px;background:#0c0915;border-radius:8px}.footer-note{margin-top:30px;color:#817592;font-size:12px}.count{color:var(--muted);font-size:12px;text-align:right}.confirm-actions{display:flex;gap:8px;margin-top:12px}@media(max-width:900px){.shell{grid-template-columns:1fr}.sidebar{display:none}.mobile-nav{display:block;width:100%;margin-top:18px}.hero{padding:32px 24px}.workspace{padding:24px}.kpis{grid-template-columns:repeat(2,1fr)}}@media(max-width:600px){.hero-row{display:block}.hero .primary{margin-top:14px}.workspace{padding:18px 14px 40px}.grid,.kpis,.form-grid{grid-template-columns:1fr}.wide{grid-column:auto}.health-banner,.broadcast-row{align-items:flex-start;flex-direction:column}.row-actions{white-space:normal}}
</style></head><body><div class="shell"><aside class="sidebar"><div class="brand"><img src="/assets/command-deck/jarvis-icon.png" alt=""><div><strong>JARVIS</strong><span class="eyebrow">Command Deck</span></div></div><nav class="nav" aria-label="Command Deck navigation"><span class="nav-label">Ship systems</span>${['overview', 'community', 'broadcasts', 'integrations', 'operations', 'settings'].map((view, index) => `<button type="button" data-view-target="${view}"${index === 0 ? ' aria-current="page"' : ''}>${view.slice(0, 1).toUpperCase() + view.slice(1)}</button>`).join('')}</nav><div class="sidebar-foot">LOCAL CONTROL PLANE</div></aside><main class="content"><header class="hero"><div class="hero-row"><div><span class="eyebrow">MuthaShip Operations</span><h1>Jarvis Command Deck</h1><p>Local operations console for the MuthaShip community.</p></div><button class="primary" id="new-transmission" type="button">New transmission</button></div><select class="mobile-nav" id="mobile-nav" aria-label="Command Deck section">${['overview', 'community', 'broadcasts', 'integrations', 'operations', 'settings'].map((view) => `<option value="${view}">${view.slice(0, 1).toUpperCase() + view.slice(1)}</option>`).join('')}</select></header><div class="workspace"><section class="view" data-view="overview"><div class="health-banner"><div><strong>${healthy ? 'All systems nominal' : 'Attention required'}</strong><div class="muted">Jarvis ${escapeHtml(snapshot.platform.version)} · ${escapeHtml(snapshot.platform.environment)} · database ${escapeHtml(snapshot.database)}</div></div><span class="status status-${healthy ? 'healthy' : 'warning'}">${healthy ? 'Healthy' : 'Review'}</span></div><div class="kpis"><article class="card kpi"><span>Command events</span><strong>${projection.events}</strong></article><article class="card kpi"><span>Failures</span><strong>${projection.failures}</strong></article><article class="card kpi"><span>Features active</span><strong>${projection.adoption}</strong></article><article class="card kpi"><span>Integration readiness</span><strong>${projection.integrationReadiness}%</strong></article></div><div class="grid"><article class="card"><h2>Platform status</h2><p><span class="status status-${snapshot.database === 'healthy' ? 'healthy' : 'error'}">Database ${escapeHtml(snapshot.database)}</span></p><p>AI provider: <strong>${escapeHtml(snapshot.providers.ai)}</strong></p><p class="muted">OpenAI ${snapshot.providers.openAiConfigured ? 'configured' : 'not configured'} · Ollama ${snapshot.providers.ollamaConfigured ? 'configured' : 'not configured'} · Web search ${snapshot.providers.webSearchConfigured ? 'configured' : 'not configured'}</p></article><article class="card"><h2>Recent activity</h2><ul class="activity"><li><span>Community features configured</span><strong>${snapshot.engagement.features.length}</strong></li><li><span>RSS delivery</span><strong>${escapeHtml(rssIntegrationStatus(snapshot.integrations.rss))}</strong></li><li><span>Sleeper Fantasy Football</span><strong>${snapshot.integrations.sleeper ? 'ready' : 'not configured'}</strong></li><li><span>GitHub read-only</span><strong>${snapshot.integrations.github ? 'ready' : 'not configured'}</strong></li></ul></article></div></section>
<section class="view" data-view="community" hidden><div class="grid"><article class="card"><h2>Community systems</h2><p>Engagement is <strong>${snapshot.engagement.enabled ? 'enabled' : 'disabled'}</strong>.</p><ul>${snapshot.engagement.features.map((feature) => `<li>${escapeHtml(feature)}</li>`).join('')}</ul></article>${snapshot.intelligence === undefined ? '<article class="card"><h2>Community intelligence</h2><p class="muted">Status unavailable.</p></article>' : `<article class="card"><h2>Community intelligence</h2><p>Approved sources: ${snapshot.intelligence.approvedSources}</p><p>Retained search: ${snapshot.intelligence.retainedSearch}</p><p>Opted-in members: ${snapshot.intelligence.optedInMembers}</p><p>Image generation: ${escapeHtml(snapshot.intelligence.imageGeneration)}</p><p>Local model: ${escapeHtml(snapshot.intelligence.localModel)}</p></article>`}</div></section>
<section class="view" data-view="broadcasts" hidden><div class="grid">${renderBroadcastCards(snapshot)}${postControl === undefined ? '<article class="card"><h2>New transmission</h2><p class="muted">One-off broadcasts are unavailable.</p></article>' : `<article class="card"><h2>New transmission</h2><p class="muted">Preview the exact public post before Jarvis sends it.</p><label>Command Deck session token<input id="admin-token" type="password" autocomplete="off" placeholder="Enter once for this session"></label><button class="secondary" id="unlock-deck" type="button">Unlock</button><p id="admin-token-status" class="muted">Locked. The token stays in memory until this page is refreshed.</p><div class="form-grid"><label>Destination<select id="post-channel">${postControl.channels.map((channel) => `<option value="${escapeHtml(channel.label)}">${escapeHtml(channel.label)}</option>`).join('')}</select></label><label>Message<textarea id="post-content" maxlength="1500" rows="7" placeholder="Compose a MuthaShip transmission"></textarea><span class="count" id="post-count">0 / 1500</span></label></div><button class="primary" id="preview-post" type="button">Preview transmission</button><div id="post-preview"></div><pre id="post-result" class="result muted" aria-live="polite"></pre></article>`}<article class="card"><h2>RSS preview</h2>${snapshot.rss ? '<label>Allowlisted HTTPS feed URL<input id="rss-url" type="url" placeholder="https://example.com/feed"></label><button class="secondary" id="preview-rss" type="button">Preview feed</button><p id="rss-result" class="result muted" aria-live="polite"></p>' : '<p class="muted">RSS preview is unavailable.</p>'}</article></div></section>
<section class="view" data-view="integrations" hidden><div class="grid"><article class="card"><h2>Connected systems</h2><p>RSS: ${escapeHtml(rssIntegrationStatus(snapshot.integrations.rss))}</p><p>Sleeper Fantasy Football: ${snapshot.integrations.sleeper ? 'ready' : 'not configured'}</p><p>GitHub read-only: ${snapshot.integrations.github ? 'ready' : 'not configured'}</p></article><article class="card"><h2>Provider…280 tokens truncated… Refresh for a current snapshot</p></div></main></div><script nonce="${nonce}">
let sessionToken='';
function adminToken(){return sessionToken||document.getElementById('admin-token')?.value.trim()||'';}
function unlockDeck(){const input=document.getElementById('admin-token');const status=document.getElementById('admin-token-status');sessionToken=input?.value.trim()||'';if(status)status.textContent=sessionToken?'Unlocked for this page session.':'Locked. Enter the local admin token to unlock.';}
function showView(name){document.querySelectorAll('.view').forEach(view=>view.hidden=view.dataset.view!==name);document.querySelectorAll('[data-view-target]').forEach(button=>button.setAttribute('aria-current',button.dataset.viewTarget===name?'page':'false'));const mobile=document.getElementById('mobile-nav');if(mobile)mobile.value=name;history.replaceState(null,'','#'+name);}
async function controlBroadcast(category,action){const token=adminToken();const result=document.getElementById('post-result')||document.getElementById('rss-result');if(!token){if(result)result.textContent='Unlock the Command Deck session first.';showView('broadcasts');return;}try{const confirmation=await fetch('/api/broadcast/'+category+'/confirmation',{method:'POST',headers:{Authorization:'Bearer '+token,'X-Broadcast-Action':action}});const confirmationBody=await confirmation.json();if(!confirmation.ok)throw new Error(confirmationBody.error||'Confirmation failed');const response=await fetch('/api/broadcast/'+category+'/'+action,{method:'POST',headers:{Authorization:'Bearer '+token,'X-Confirmation-Nonce':confirmationBody.nonce}});const body=await response.json();if(!response.ok)throw new Error(body.error||'Request failed');if(result)result.textContent=category+' '+action+'d successfully. Refreshing...';setTimeout(()=>location.reload(),300);}catch(error){if(result)result.textContent=error instanceof Error?error.message:'Broadcast control failed';}}
let pendingPost=null;
async function previewPost(){const token=adminToken();const channelId=document.getElementById('post-channel').value;const content=document.getElementById('post-content').value;const result=document.getElementById('post-result');if(!token){result.textContent='Unlock the Command Deck session first.';return;}if(!channelId||!content.trim()){result.textContent='Choose a destination and enter a message first.';return;}try{const response=await fetch('/api/post/preview',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({channelId,content})});const body=await response.json();if(!response.ok)throw new Error(body.error||'Preview failed');pendingPost=body;document.getElementById('post-preview').innerHTML='<div class="preview-card"><span class="eyebrow">Public transmission preview</span><h3>'+escapeText(body.title)+'</h3><p>'+escapeText(body.description)+'</p><p class="muted">Destination: '+escapeText(body.destination)+'</p><div class="confirm-actions"><button class="primary" id="confirm-post" type="button">Send transmission</button><button class="secondary" id="cancel-post" type="button">Cancel</button></div></div>';document.getElementById('confirm-post').addEventListener('click',confirmPost);document.getElementById('cancel-post').addEventListener('click',cancelPost);result.textContent='Preview ready. Review the exact public message above.';}catch(error){result.textContent=error instanceof Error?error.message:'Broadcast unavailable';}}
function escapeText(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
async function finishPost(path,success){if(!pendingPost)return;const token=adminToken();const response=await fetch(path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-Confirmation-Nonce':pendingPost.confirmationNonce},body:JSON.stringify({draftId:pendingPost.draftId})});const body=await response.json();if(!response.ok)throw new Error(body.error||'Request failed');document.getElementById('post-result').textContent=success;document.getElementById('post-preview').innerHTML='';pendingPost=null;}
async function confirmPost(){try{await finishPost('/api/post/confirm','Transmission sent successfully.');}catch(error){document.getElementById('post-result').textContent=error instanceof Error?error.message:'Delivery failed';}}
async function cancelPost(){try{await finishPost('/api/post/cancel','Transmission cancelled.');}catch(error){document.getElementById('post-result').textContent=error instanceof Error?error.message:'Cancellation failed';}}
async function previewRss(){const token=adminToken();const url=document.getElementById('rss-url').value;if(!token){document.getElementById('rss-result').textContent='Enter the local admin token above first.';return;}if(!url){document.getElementById('rss-result').textContent='Enter a feed URL first.';return;}const result=document.getElementById('rss-result');try{const response=await fetch('/api/rss/preview',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({url})});const body=await response.json();if(!response.ok)throw new Error(body.error||'Preview failed');const entries=body.items.map((item)=>[item.title,item.url,item.publishedAt].join('\\n')).join('\\n\\n');result.textContent=body.items.length+' feed items found. No feed was saved; saving establishes a baseline, so historical entries are not posted.\\n\\n'+entries;}catch(error){result.textContent=error instanceof Error?error.message:'RSS preview failed';}}
document.querySelectorAll('[data-view-target]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.viewTarget)));document.getElementById('mobile-nav')?.addEventListener('change',event=>showView(event.target.value));document.getElementById('new-transmission')?.addEventListener('click',()=>showView('broadcasts'));document.getElementById('unlock-deck')?.addEventListener('click',unlockDeck);document.getElementById('preview-post')?.addEventListener('click',previewPost);document.getElementById('preview-rss')?.addEventListener('click',previewRss);document.getElementById('post-content')?.addEventListener('input',event=>{document.getElementById('post-count').textContent=event.target.value.length+' / 1500';});document.querySelectorAll('.broadcast-action').forEach(button=>button.addEventListener('click',()=>controlBroadcast(button.dataset.category,button.dataset.action)));showView(location.hash.slice(1)||'overview');
</script><script nonce="${nonce}">const workspace=document.querySelector('.workspace');if(workspace?.firstChild?.nodeType===Node.TEXT_NODE)workspace.firstChild.textContent='';</script></body></html>`;
};

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
    if (request.method === 'GET' && path.startsWith('/assets/command-deck/')) {
      const asset =
        path === '/assets/command-deck/jarvis-icon.png'
          ? {
              file: resolve(process.cwd(), 'assets', 'jarvis-discord-icon.png'),
              type: 'image/png',
            }
          : path === '/assets/command-deck/bridge-banner.webp'
            ? {
                file: resolve(
                  process.cwd(),
                  'assets',
                  'command-deck',
                  'bridge-banner.webp',
                ),
                type: 'image/webp',
              }
            : undefined;
      if (asset === undefined) {
        response.writeHead(404, {
          'content-type': 'text/plain; charset=utf-8',
          'x-content-type-options': 'nosniff',
        });
        response.end('Not found');
        return;
      }
      try {
        response.writeHead(200, {
          'content-type': asset.type,
          'cache-control': 'public, max-age=3600',
          'x-content-type-options': 'nosniff',
        });
        response.end(await readFile(asset.file));
      } catch {
        response.writeHead(404, {
          'content-type': 'text/plain; charset=utf-8',
          'x-content-type-options': 'nosniff',
        });
        response.end('Not found');
      }
      return;
    }
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
      const nonce = randomUUID().replaceAll('-', '');
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': `default-src 'self'; img-src 'self'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
      });
      response.end(html(snapshot, options.postControl, nonce));
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
