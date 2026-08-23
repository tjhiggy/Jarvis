'use client';

import Image from 'next/image';
import { useState } from 'react';
import {
  getCommandDeckSnapshot,
  getOverallSummary,
  getSnapshotFreshness,
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
  return (
    <>
      <div className="banner">
        <div>
          <p className="eyebrow">Platform intelligence</p>
          <h2>
            A system is offline.
            <br />
            The deck has the receipts.
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
            <small>Read-only connection</small>
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
            <span className="readonly-pill">Read-only operations view</span>
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
        ) : (
          <AreaView area={activeArea} />
        )}
      </section>
    </main>
  );
}
