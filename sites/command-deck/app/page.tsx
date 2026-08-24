'use client';

import Image from 'next/image';
import { useState } from 'react';
import {
  cancelCommandDeckPreview,
  confirmCommandDeckMutation,
  createCommandDeckIdempotencyKey,
  getCommandDeckMutationCatalog,
  getCommandDeckSnapshot,
  getOverallSummary,
  getOverviewCopy,
  getSnapshotFreshness,
  previewCommandDeckMutation,
  previewCommandDeckRollback,
  resolveCommandDeckApiBaseUrl,
  type CommandDeckApiResult,
  type CommandDeckMutationAction,
  type CommandDeckMutationCatalog,
  type CommandDeckPreview,
  type CommandDeckReceipt,
  type ReadOnlyArea,
  type ResilientViewState,
} from './lib/command-deck';

const snapshot = getCommandDeckSnapshot();

const navigation = [
  'Overview',
  'Community',
  'Broadcasts',
  'Integrations',
  'Operations',
  'Settings',
] as const;
type Area = (typeof navigation)[number];
const stateLabels = {
  healthy: 'Operational',
  degraded: 'Attention needed',
  stale: 'Data delayed',
  unavailable: 'Unavailable',
};

function Overview() {
  const freshness = getSnapshotFreshness(snapshot);
  const summary = getOverallSummary(snapshot);
  const overviewCopy = getOverviewCopy(summary.state);
  return (
    <>
      <div className="banner">
        <div>
          <p className="eyebrow">Platform intelligence</p>
          <h2>
            {overviewCopy.lead}
            <br />
            {overviewCopy.follow}
          </h2>
          <p>
            Jarvis is connected, community services are active, and the latest
            operational snapshot is safe to share.
          </p>
        </div>
        <div className="banner-stat">
          <strong>{summary.attentionCount}</strong>
          <span>Systems need attention</span>
        </div>
      </div>
      <section className="status-strip" aria-label="Current platform summary">
        <article>
          <span className={`status-icon ${summary.state}`}>!</span>
          <div>
            <small>Overall status</small>
            <strong>{summary.label}</strong>
          </div>
        </article>
        <article>
          <span className="status-icon degraded">!</span>
          <div>
            <small>Open attention</small>
            <strong>{summary.attentionCount} integrations</strong>
          </div>
        </article>
        <article>
          <span className="status-icon neutral">↗</span>
          <div>
            <small>7-day activity</small>
            <strong>{snapshot.activity.events} events</strong>
          </div>
        </article>
        <article>
          <span className="status-icon healthy">0</span>
          <div>
            <small>Command failures</small>
            <strong>{snapshot.activity.failures} detected</strong>
          </div>
        </article>
      </section>
      <div className="content-grid">
        <section className="panel service-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Live systems</p>
              <h2>Platform health</h2>
            </div>
            <span className={freshness.state}>
              Snapshot age: {freshness.ageMinutes} minutes
            </span>
          </div>
          <div className="service-list">
            {snapshot.services.map((service) => (
              <article key={service.name}>
                <span
                  className={`service-orb ${service.state}`}
                  aria-hidden="true"
                />
                <div>
                  <strong>{service.name}</strong>
                  <small>{service.detail}</small>
                </div>
                <span className={`state ${service.state}`}>
                  {stateLabels[service.state]}
                </span>
                <b>{service.metric}</b>
              </article>
            ))}
          </div>
        </section>
        <aside className="panel release-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Current release</p>
              <h2>Jarvis {snapshot.release.version}</h2>
            </div>
            <span className="release-badge">Live</span>
          </div>
          <dl>
            <div>
              <dt>Environment</dt>
              <dd>{snapshot.release.environment}</dd>
            </div>
            <div>
              <dt>Commit</dt>
              <dd>{snapshot.release.commit}</dd>
            </div>
            <div>
              <dt>Contract</dt>
              <dd>v{snapshot.contractVersion}</dd>
            </div>
          </dl>
          <div className="release-note">
            <span>✦</span>
            <p>
              <strong>Command Deck is now decoupled.</strong>
              <br />
              Bounded operations data. No Discord content. No credentials. No
              nonsense.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}

function AreaView({ area }: { area: ReadOnlyArea }) {
  const data = snapshot.areas[area];
  return (
    <section className="area-view">
      <div className="area-hero">
        <p className="eyebrow">{data.eyebrow}</p>
        <h2>{data.title}</h2>
        <p>{data.intro}</p>
      </div>
      <div className="area-grid">
        {data.cards.map((card) => (
          <article className="panel area-card" key={card.name}>
            <small>{card.name}</small>
            <strong>{card.metric}</strong>
            <span>{card.state}</span>
          </article>
        ))}
      </div>
      <div className="panel area-table">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Recent snapshot</p>
            <h2>Operational detail</h2>
          </div>
          <span>Safe metadata only</span>
        </div>
        {data.cards.map((card) => (
          <div className="table-row" key={card.name}>
            <strong>{card.name}</strong>
            <span>{card.metric}</span>
            <b>{card.state}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

const resilientCopy: Record<
  ResilientViewState,
  { title: string; detail: string; icon: string }
> = {
  loading: {
    title: 'Loading snapshot',
    detail: 'Retrieving bounded operational data',
    icon: '',
  },
  empty: {
    title: 'No recent records',
    detail: 'The selected period is empty',
    icon: '∅',
  },
  unavailable: {
    title: 'Source unavailable',
    detail: 'Last known safe state is preserved',
    icon: '!',
  },
  unauthorized: {
    title: 'Access restricted',
    detail: 'This view is not authorized',
    icon: '×',
  },
};

export function ResilientState({ state }: { state: ResilientViewState }) {
  const copy = resilientCopy[state];
  return (
    <article
      className={`panel state-demo ${state === 'unauthorized' ? 'restricted' : state}`}
      role="status"
    >
      {state === 'loading' ? (
        <span aria-hidden="true" />
      ) : (
        <b aria-hidden="true">{copy.icon}</b>
      )}
      <div>
        <strong>{copy.title}</strong>
        <small>{copy.detail}</small>
      </div>
    </article>
  );
}

type ControlPhase =
  | 'locked'
  | 'loading'
  | 'ready'
  | 'preview'
  | 'confirming'
  | 'retryable'
  | 'permanent'
  | 'unauthorized'
  | 'stale'
  | 'succeeded'
  | 'cancelled'
  | 'rolled-back';

type PendingChange = {
  preview: CommandDeckPreview;
  action?: CommandDeckMutationAction;
  idempotencyKey: string;
  rollback: boolean;
};

type FailedOperation = 'confirm' | 'cancel';

const controlCopy: Record<ControlPhase, string> = {
  locked:
    'Controls locked. Use an active-tab write access code to load bounded options.',
  loading: 'Loading safe controls',
  ready: 'Safe controls ready',
  preview: 'Preview ready. Review the exact change before confirming.',
  confirming: 'Confirming with Jarvis. Do not close this tab.',
  retryable: 'Jarvis could not apply this change. Retry the same confirmation.',
  permanent: 'Jarvis rejected this change. No retry is available.',
  unauthorized: 'Access restricted. Check the active-tab write access code.',
  stale: 'Preview expired or changed. Create a new preview.',
  succeeded: 'Change succeeded.',
  cancelled: 'Preview cancelled. No change was sent.',
  'rolled-back': 'Rollback succeeded.',
};

const readableValue = (value: unknown): string => {
  if (value === undefined) return 'not configured';
  if (value === true) return 'enabled';
  if (value === false) return 'disabled';
  if (value !== null && typeof value === 'object') {
    const candidate = value as { url?: unknown; label?: unknown };
    if (typeof candidate.url === 'string')
      return typeof candidate.label === 'string'
        ? `${candidate.label} (${candidate.url})`
        : candidate.url;
  }
  return String(value);
};

function requestFailure<T>(result: CommandDeckApiResult<T>): {
  phase: Extract<
    ControlPhase,
    'unauthorized' | 'stale' | 'retryable' | 'permanent'
  >;
  detail: string;
} {
  if (result.ok) throw new Error('Expected a Command Deck request failure.');
  if (result.status === 401 || result.status === 403)
    return { phase: 'unauthorized', detail: controlCopy.unauthorized };
  if (
    result.code === 'preview_stale' ||
    result.code === 'precondition_failed' ||
    result.code === 'rollback_conflict' ||
    result.code === 'preview_cancelled'
  )
    return { phase: 'stale', detail: controlCopy.stale };
  if (result.code === 'invalid_api_base')
    return { phase: 'permanent', detail: result.message };
  if (
    result.status >= 400 &&
    result.status < 500 &&
    result.code !== 'rate_limited'
  )
    return { phase: 'permanent', detail: controlCopy.permanent };
  return { phase: 'retryable', detail: result.message };
}

function ControlCard({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <article className="panel control-card">
      <div>
        <p className="eyebrow">Bounded change</p>
        <h3>{title}</h3>
        <p>{detail}</p>
      </div>
      {children}
    </article>
  );
}

export function SettingsControls({ apiBaseUrl }: { apiBaseUrl?: string }) {
  const runtimeApiBaseUrl =
    apiBaseUrl ??
    (globalThis as { __COMMAND_DECK_API_BASE_URL__?: unknown })
      .__COMMAND_DECK_API_BASE_URL__ ??
    (typeof location !== 'undefined' && location.hostname === 'localhost'
      ? 'http://127.0.0.1:8787'
      : undefined);
  const safeApiBaseUrl = resolveCommandDeckApiBaseUrl(runtimeApiBaseUrl);
  const [tokenDraft, setTokenDraft] = useState('');
  const [writeToken, setWriteToken] = useState<string>();
  const [catalog, setCatalog] = useState<CommandDeckMutationCatalog>();
  const [phase, setPhase] = useState<ControlPhase>('locked');
  const [detail, setDetail] = useState(controlCopy.locked);
  const [pending, setPending] = useState<PendingChange>();
  const [receipt, setReceipt] = useState<CommandDeckReceipt>();
  const [failedOperation, setFailedOperation] = useState<FailedOperation>();
  const [broadcastCategory, setBroadcastCategory] = useState('');
  const [broadcastState, setBroadcastState] = useState<'enabled' | 'paused'>(
    'paused',
  );
  const [feature, setFeature] = useState('');
  const [featureEnabled, setFeatureEnabled] = useState(true);
  const [rssUrl, setRssUrl] = useState('');
  const [rssLabel, setRssLabel] = useState('');
  const [rssFeedUrl, setRssFeedUrl] = useState('');

  const relock = (detail = controlCopy.locked) => {
    setWriteToken(undefined);
    setCatalog(undefined);
    setPending(undefined);
    setReceipt(undefined);
    setFailedOperation(undefined);
    setTokenDraft('');
    setBroadcastCategory('');
    setFeature('');
    setRssFeedUrl('');
    setPhase(detail === controlCopy.locked ? 'locked' : 'unauthorized');
    setDetail(detail);
  };

  const handleFailure = <T,>(
    result: CommandDeckApiResult<T>,
    operation?: FailedOperation,
  ) => {
    const failure = requestFailure(result);
    if (failure.phase === 'unauthorized') {
      relock(failure.detail);
      return;
    }
    if (failure.phase === 'permanent' || failure.phase === 'stale')
      setPending(undefined);
    setFailedOperation(failure.phase === 'retryable' ? operation : undefined);
    setPhase(failure.phase);
    setDetail(failure.detail);
  };

  const unlock = async () => {
    const token = tokenDraft.trim();
    if (token === '') return;
    setPhase('loading');
    setDetail(controlCopy.loading);
    const result = await getCommandDeckMutationCatalog(safeApiBaseUrl, token);
    if (!result.ok) {
      handleFailure(result);
      return;
    }
    setWriteToken(token);
    setTokenDraft('');
    setCatalog(result.value);
    setBroadcastCategory(result.value.broadcastCategories[0] ?? '');
    setFeature(result.value.featureFlags[0] ?? '');
    setPhase('ready');
    setDetail(controlCopy.ready);
  };

  const previewChange = async (action: CommandDeckMutationAction) => {
    if (writeToken === undefined) return;
    setPhase('loading');
    setDetail('Preparing an exact preview with Jarvis.');
    const result = await previewCommandDeckMutation(
      safeApiBaseUrl,
      writeToken,
      action,
    );
    if (!result.ok) {
      handleFailure(result);
      return;
    }
    setPending({
      preview: result.value,
      action,
      idempotencyKey: createCommandDeckIdempotencyKey(),
      rollback: false,
    });
    setPhase('preview');
    setDetail(controlCopy.preview);
  };

  const cancelPreview = async () => {
    if (writeToken === undefined || pending === undefined) return;
    setPhase('loading');
    setDetail('Cancelling preview with Jarvis.');
    const result = await cancelCommandDeckPreview(
      safeApiBaseUrl,
      writeToken,
      pending.preview.id,
    );
    if (!result.ok) {
      handleFailure(result, 'cancel');
      return;
    }
    setPending(undefined);
    setPhase('cancelled');
    setDetail(controlCopy.cancelled);
  };

  const confirmPreview = async () => {
    if (writeToken === undefined || pending === undefined) return;
    setPhase('confirming');
    setDetail(controlCopy.confirming);
    const result = await confirmCommandDeckMutation(
      safeApiBaseUrl,
      writeToken,
      pending.preview.id,
      pending.action,
      pending.idempotencyKey,
      pending.rollback,
    );
    if (!result.ok) {
      handleFailure(result, 'confirm');
      return;
    }
    setPending(undefined);
    setReceipt(result.value);
    setPhase(pending.rollback ? 'rolled-back' : 'succeeded');
    setDetail(
      pending.rollback
        ? controlCopy['rolled-back']
        : `Change succeeded. Receipt: ${result.value.id}.`,
    );
  };

  const previewRollback = async () => {
    if (writeToken === undefined || receipt?.rollbackToken === undefined)
      return;
    setPhase('loading');
    setDetail('Preparing a compensating rollback preview with Jarvis.');
    const result = await previewCommandDeckRollback(
      safeApiBaseUrl,
      writeToken,
      receipt.rollbackToken,
    );
    if (!result.ok) {
      handleFailure(result);
      return;
    }
    setPending({
      preview: result.value,
      idempotencyKey: createCommandDeckIdempotencyKey(),
      rollback: true,
    });
    setPhase('preview');
    setDetail('Rollback preview ready.');
  };

  const controlsReady = catalog !== undefined && writeToken !== undefined;
  return (
    <section
      className="settings-controls"
      aria-labelledby="safe-controls-heading"
    >
      <div className="settings-heading">
        <div>
          <p className="eyebrow">Jarvis-authoritative changes</p>
          <h2 id="safe-controls-heading">Safe controls</h2>
          <p>
            Only configured categories, supported features, and approved RSS
            hosts appear here. Discord commands remain the fallback.
          </p>
        </div>
        <p className={`control-status ${phase}`} role="status">
          {detail}
        </p>
      </div>

      {!controlsReady && phase !== 'loading' ? (
        <form
          className="unlock-form"
          onSubmit={(event) => {
            event.preventDefault();
            void unlock();
          }}
        >
          <label>
            Write access code
            <input
              type="password"
              value={tokenDraft}
              onChange={(event) => setTokenDraft(event.target.value)}
              autoComplete="off"
            />
          </label>
          <button type="submit" disabled={tokenDraft.trim() === ''}>
            {phase === 'unauthorized'
              ? 'Change access code'
              : 'Unlock controls'}
          </button>
          <small>The access code stays in this tab&apos;s memory only.</small>
        </form>
      ) : null}

      <div className="control-grid" aria-busy={phase === 'loading'}>
        <ControlCard
          title="Broadcast state"
          detail="Pause or resume only an allowlisted broadcast category."
        >
          <label>
            Broadcast category
            <select
              value={broadcastCategory}
              onChange={(event) => setBroadcastCategory(event.target.value)}
              disabled={!controlsReady}
            >
              {(catalog?.broadcastCategories ?? []).map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label>
            Desired broadcast state
            <select
              value={broadcastState}
              onChange={(event) =>
                setBroadcastState(event.target.value as 'enabled' | 'paused')
              }
              disabled={!controlsReady}
            >
              <option value="paused">Paused</option>
              <option value="enabled">Enabled</option>
            </select>
          </label>
          <button
            type="button"
            disabled={
              !controlsReady ||
              broadcastCategory === '' ||
              pending !== undefined ||
              phase === 'loading' ||
              phase === 'confirming'
            }
            onClick={() =>
              void previewChange({
                type: 'broadcast_state',
                category: broadcastCategory,
                state: broadcastState,
              })
            }
          >
            Preview broadcast change
          </button>
        </ControlCard>

        <ControlCard
          title="Community feature"
          detail="Enable or disable a feature Jarvis already supports."
        >
          <label>
            Community feature
            <select
              value={feature}
              onChange={(event) => setFeature(event.target.value)}
              disabled={!controlsReady}
            >
              {(catalog?.featureFlags ?? []).map((flag) => (
                <option key={flag} value={flag}>
                  {flag}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={featureEnabled}
              onChange={(event) => setFeatureEnabled(event.target.checked)}
              disabled={!controlsReady}
            />
            Enable selected feature
          </label>
          <button
            type="button"
            disabled={
              !controlsReady ||
              feature === '' ||
              pending !== undefined ||
              phase === 'loading' ||
              phase === 'confirming'
            }
            onClick={() =>
              void previewChange({
                type: 'feature_flag',
                feature,
                enabled: featureEnabled,
              })
            }
          >
            Preview feature change
          </button>
        </ControlCard>

        <ControlCard
          title="RSS feed"
          detail="Add an approved HTTPS feed. Jarvis retains the configured destination."
        >
          <label>
            RSS feed URL
            <input
              type="url"
              value={rssUrl}
              onChange={(event) => setRssUrl(event.target.value)}
              placeholder={
                catalog?.rssHosts[0] === undefined
                  ? 'No approved RSS host'
                  : `https://${catalog.rssHosts[0]}/feed.xml`
              }
              disabled={!controlsReady}
            />
          </label>
          <label>
            RSS feed label
            <input
              value={rssLabel}
              onChange={(event) => setRssLabel(event.target.value)}
              disabled={!controlsReady}
            />
          </label>
          <button
            type="button"
            disabled={
              !controlsReady ||
              rssUrl.trim() === '' ||
              rssLabel.trim() === '' ||
              pending !== undefined ||
              phase === 'loading' ||
              phase === 'confirming'
            }
            onClick={() =>
              void previewChange({
                type: 'rss_feed',
                operation: 'add',
                url: rssUrl.trim(),
                label: rssLabel.trim(),
              })
            }
          >
            Preview RSS change
          </button>
          <label>
            Existing RSS feed
            <select
              value={rssFeedUrl}
              onChange={(event) => setRssFeedUrl(event.target.value)}
              disabled={
                !controlsReady || pending !== undefined || phase === 'loading'
              }
            >
              <option value="">Select an existing feed</option>
              {(catalog?.rssFeeds ?? []).map((feed) => (
                <option key={feed.url} value={feed.url}>
                  {feed.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={
              !controlsReady ||
              rssFeedUrl === '' ||
              pending !== undefined ||
              phase === 'loading' ||
              phase === 'confirming'
            }
            onClick={() =>
              void previewChange({
                type: 'rss_feed',
                operation: 'remove',
                url: rssFeedUrl,
              })
            }
          >
            Preview RSS removal
          </button>
        </ControlCard>
      </div>

      {pending !== undefined ? (
        <section
          className="panel preview-panel"
          aria-label="Exact change preview"
        >
          <p className="eyebrow">Exact change preview</p>
          <h3>{pending.preview.target}</h3>
          <dl>
            <div>
              <dt>Before</dt>
              <dd>Before: {readableValue(pending.preview.diff.before)}</dd>
            </div>
            <div>
              <dt>After</dt>
              <dd>After: {readableValue(pending.preview.diff.after)}</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>{new Date(pending.preview.expiresAt).toLocaleString()}</dd>
            </div>
          </dl>
          <div className="preview-actions">
            <button
              type="button"
              onClick={() => void confirmPreview()}
              disabled={phase === 'confirming' || failedOperation === 'cancel'}
            >
              {phase === 'retryable' && failedOperation === 'confirm'
                ? 'Retry confirmation'
                : pending.rollback
                  ? 'Confirm rollback'
                  : 'Confirm change'}
            </button>
            <button
              className="secondary-action"
              type="button"
              onClick={() => void cancelPreview()}
              disabled={phase === 'confirming'}
            >
              {phase === 'retryable' && failedOperation === 'cancel'
                ? 'Retry cancellation'
                : 'Cancel preview'}
            </button>
          </div>
        </section>
      ) : null}

      {phase === 'succeeded' && receipt?.rollbackToken !== undefined ? (
        <button
          type="button"
          className="rollback-action"
          onClick={() => void previewRollback()}
        >
          Preview rollback
        </button>
      ) : null}
    </section>
  );
}

function Operations() {
  const freshness = getSnapshotFreshness(snapshot);
  return (
    <section className="area-view">
      <div className="area-hero">
        <p className="eyebrow">Resilience and recovery</p>
        <h2>Operational timeline</h2>
        <p>
          Every state has an honest outcome. No blank screens and no cheerful
          lies when a source is broken.
        </p>
      </div>
      <div className="state-grid">
        {snapshot.operationStates.map((state) => (
          <ResilientState key={state} state={state} />
        ))}
      </div>
      <div className="panel area-table">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">System events</p>
            <h2>Latest safe activity</h2>
          </div>
          <span className={freshness.state}>
            Snapshot age: {freshness.ageMinutes} minutes
          </span>
        </div>
        {snapshot.timeline.map((event) => (
          <div className="table-row" key={event.event}>
            <strong>{event.event}</strong>
            <span>{event.source}</span>
            <b className={event.outcome === 'review' ? 'warn' : ''}>
              {event.outcome === 'review' ? 'Review' : 'Success'}
            </b>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function Home() {
  const [activeArea, setActiveArea] = useState<Area>('Overview');
  return (
    <main className="deck-shell">
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => setActiveArea('Overview')}
          aria-label="MuthaShip Command Deck home"
        >
          <span className="brand-mark">
            <Image
              src="/jarvis-discord-icon.png"
              alt=""
              width={48}
              height={48}
              priority
            />
          </span>
          <span>
            <strong>MuthaShip</strong>
            <small>Command Deck</small>
          </span>
        </button>
        <nav aria-label="Command Deck">
          {navigation.map((item, index) => (
            <button
              key={item}
              className={activeArea === item ? 'active' : ''}
              onClick={() => setActiveArea(item)}
              aria-pressed={activeArea === item}
            >
              <span aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              {item}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="live-dot" aria-hidden="true" />
          <div>
            <strong>Jarvis online</strong>
            <small>Protected connection</small>
          </div>
        </div>
      </aside>
      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">MuthaShip operations</p>
            <h1>Command Deck</h1>
          </div>
          <div className="top-actions">
            <span className="readonly-pill">Private operations view</span>
            <span
              className="operator-mark"
              aria-label="Jarvis platform identity"
            >
              <Image
                src="/jarvis-discord-icon.png"
                alt=""
                width={34}
                height={34}
              />
            </span>
          </div>
        </header>
        {activeArea === 'Overview' ? (
          <Overview />
        ) : activeArea === 'Operations' ? (
          <Operations />
        ) : activeArea === 'Settings' ? (
          <>
            <AreaView area="Settings" />
            <SettingsControls />
          </>
        ) : (
          <AreaView area={activeArea} />
        )}
      </section>
    </main>
  );
}
