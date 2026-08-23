'use client';

import Image from 'next/image';
import { useState } from 'react';
import { commandDeckFixture as snapshot } from './lib/command-deck';

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
  return (
    <>
      <div className="banner">
        <div>
          <p className="eyebrow">Platform intelligence</p>
          <h2>
            The ship is steady.
            <br />
            One system needs eyes.
          </h2>
          <p>
            Jarvis is connected, community services are active, and the latest
            operational snapshot is safe to share.
          </p>
        </div>
        <div className="banner-stat">
          <strong>99.98%</strong>
          <span>Platform availability</span>
        </div>
      </div>
      <section className="status-strip" aria-label="Current platform summary">
        <article>
          <span className="status-icon healthy">✓</span>
          <div>
            <small>Overall status</small>
            <strong>Operational</strong>
          </div>
        </article>
        <article>
          <span className="status-icon degraded">!</span>
          <div>
            <small>Open attention</small>
            <strong>1 integration</strong>
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
            <span>Last updated 8 minutes ago</span>
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

const areaData: Record<
  Exclude<Area, 'Overview' | 'Operations'>,
  {
    eyebrow: string;
    title: string;
    intro: string;
    cards: Array<[string, string, string]>;
  }
> = {
  Community: {
    eyebrow: 'Engagement intelligence',
    title: 'Community pulse',
    intro: 'A content-free view of participation trends across the MuthaShip.',
    cards: [
      ['Introductions', '12 this month', 'Healthy'],
      ['Suggestions', '4 open', 'Review queue'],
      ['Trivia', '68% participation', 'Trending up'],
      ['Events', '3 upcoming', 'Scheduler healthy'],
    ],
  },
  Broadcasts: {
    eyebrow: 'Transmission log',
    title: 'Broadcast history',
    intro:
      'Safe delivery receipts and destinations. Message bodies remain where they belong: out of this deck.',
    cards: [
      ['Latest delivery', 'Test channel', 'Delivered'],
      ['Scheduled posts', '2 queued', 'Ready'],
      ['Failed deliveries', '0 this week', 'Clear'],
      ['Allowed channels', '3 configured', 'Bounded'],
    ],
  },
  Integrations: {
    eyebrow: 'Connected services',
    title: 'Connected systems',
    intro:
      'Readiness, freshness, and safe operational detail for every external integration.',
    cards: [
      ['Discord', 'Gateway online', 'Operational'],
      ['Sleeper Fantasy', 'League synced', 'Ready'],
      ['Xbox RSS', 'Feed delayed', 'Review'],
      ['SQLite', 'Local store healthy', 'Operational'],
    ],
  },
  Settings: {
    eyebrow: 'Read-only configuration',
    title: 'Configuration posture',
    intro:
      'What is enabled, what is bounded, and what still requires local administration.',
    cards: [
      ['Feature flags', '4 enabled', 'Configured'],
      ['Destinations', '3 allowlisted', 'Bounded'],
      ['Data retention', 'Policy active', 'Compliant'],
      ['Write controls', 'Unavailable here', 'Read-only'],
    ],
  },
};

function AreaView({
  area,
}: {
  area: Exclude<Area, 'Overview' | 'Operations'>;
}) {
  const data = areaData[area];
  return (
    <section className="area-view">
      <div className="area-hero">
        <p className="eyebrow">{data.eyebrow}</p>
        <h2>{data.title}</h2>
        <p>{data.intro}</p>
      </div>
      <div className="area-grid">
        {data.cards.map(([name, metric, state]) => (
          <article className="panel area-card" key={name}>
            <small>{name}</small>
            <strong>{metric}</strong>
            <span>{state}</span>
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
        {data.cards.map(([name, metric, state]) => (
          <div className="table-row" key={name}>
            <strong>{name}</strong>
            <span>{metric}</span>
            <b>{state}</b>
          </div>
        ))}
      </div>
    </section>
  );
}

function Operations() {
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
        <article className="panel state-demo loading">
          <span />
          <div>
            <strong>Loading snapshot</strong>
            <small>Retrieving bounded operational data</small>
          </div>
        </article>
        <article className="panel state-demo">
          <b>∅</b>
          <div>
            <strong>No recent records</strong>
            <small>The selected period is empty</small>
          </div>
        </article>
        <article className="panel state-demo unavailable">
          <b>!</b>
          <div>
            <strong>Source unavailable</strong>
            <small>Last known safe state is preserved</small>
          </div>
        </article>
        <article className="panel state-demo restricted">
          <b>×</b>
          <div>
            <strong>Access restricted</strong>
            <small>This view is not authorized</small>
          </div>
        </article>
      </div>
      <div className="panel area-table">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">System events</p>
            <h2>Latest safe activity</h2>
          </div>
          <span>Last updated 8 minutes ago</span>
        </div>
        <div className="table-row">
          <strong>Scheduler completed</strong>
          <span>Engagement engine</span>
          <b>Success</b>
        </div>
        <div className="table-row">
          <strong>RSS freshness warning</strong>
          <span>Xbox Wire</span>
          <b className="warn">Review</b>
        </div>
        <div className="table-row">
          <strong>Snapshot published</strong>
          <span>Command Deck</span>
          <b>Success</b>
        </div>
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
            <button type="button" aria-label="Open operator profile">
              <Image
                src="/jarvis-discord-icon.png"
                alt=""
                width={34}
                height={34}
              />
            </button>
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
