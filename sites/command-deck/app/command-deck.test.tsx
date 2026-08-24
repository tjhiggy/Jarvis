// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Home, { ResilientState, SettingsControls } from './page';
import {
  commandDeckFixture,
  getCommandDeckSnapshot,
  getOverallSummary,
  getOverviewCopy,
  getSnapshotFreshness,
  validateCommandDeckSnapshot,
} from './lib/command-deck';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const catalog = {
  schemaVersion: '1.0',
  actions: {
    broadcastCategories: ['daily'],
    featureFlags: ['trivia'],
    rssHosts: ['news.example.test'],
    rssFeeds: [],
  },
};

const preview = {
  id: 'preview-1',
  expiresAt: '2026-08-23T18:00:00.000Z',
  target: 'broadcast:daily',
  diff: { before: true, after: false },
};

function unlockControls() {
  fireEvent.change(screen.getByLabelText('Write access code'), {
    target: { value: 'write-only-token' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Unlock controls' }));
}

describe('Command Deck snapshot contract', () => {
  it('accepts the versioned safe fixture', () => {
    expect(validateCommandDeckSnapshot(commandDeckFixture)).toEqual(
      commandDeckFixture,
    );
    expect(Object.keys(commandDeckFixture.areas)).toEqual([
      'Community',
      'Broadcasts',
      'Integrations',
      'Settings',
    ]);
    expect(getCommandDeckSnapshot()).toEqual(commandDeckFixture);
  });

  it('derives fresh and stale outcomes from the generated timestamp', () => {
    expect(
      getSnapshotFreshness(
        commandDeckFixture,
        new Date('2026-08-23T12:16:00-04:00'),
      ).state,
    ).toBe('fresh');
    expect(
      getSnapshotFreshness(
        commandDeckFixture,
        new Date('2026-08-23T12:25:00-04:00'),
      ).state,
    ).toBe('stale');
  });

  it('rejects unsupported contract versions', () => {
    expect(() =>
      validateCommandDeckSnapshot({
        ...commandDeckFixture,
        contractVersion: '2.0',
      }),
    ).toThrow(/contract version/i);
  });

  it.each([
    [{ ...commandDeckFixture, generatedAt: 'not-a-date' }, /generatedAt/i],
    [
      { ...commandDeckFixture, operationStates: ['kaboom'] },
      /operation state/i,
    ],
    [
      {
        ...commandDeckFixture,
        services: [{ ...commandDeckFixture.services[0], state: 'mystery' }],
      },
      /service state/i,
    ],
  ])('rejects malformed runtime payloads', (payload, message) => {
    expect(() => validateCommandDeckSnapshot(payload)).toThrow(message);
  });

  it('derives the honest overall state from service health', () => {
    expect(getOverallSummary(commandDeckFixture)).toEqual({
      state: 'unavailable',
      label: 'Service disruption',
      attentionCount: 2,
    });
  });

  it.each([
    ['healthy', 'All systems are nominal.'],
    ['degraded', 'A system needs eyes.'],
    ['stale', 'A system needs eyes.'],
    ['unavailable', 'The deck has the receipts.'],
  ] as const)('derives truthful %s overview copy', (state, expected) => {
    expect(getOverviewCopy(state).follow).toBe(expected);
  });
});

describe('Command Deck overview', () => {
  it('renders the MuthaShip operations shell as read-only', () => {
    render(<Home />);

    expect(
      screen.getByRole('heading', { name: /command deck/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/private operations view/i)).toBeInTheDocument();
    expect(screen.getByText('Jarvis 1.5.0')).toBeInTheDocument();
    expect(
      screen.getByRole('navigation', { name: /command deck/i }),
    ).toBeInTheDocument();
  });

  it('surfaces degraded and stale states without exposing secrets', () => {
    render(<Home />);

    expect(screen.getByText(/data delayed/i)).toBeInTheDocument();
    expect(screen.getByText(/^unavailable$/i)).toBeInTheDocument();
    expect(screen.getByText('Service disruption')).toBeInTheDocument();
    expect(screen.getByText(/snapshot age: \d+ minutes/i)).toBeInTheDocument();
    expect(screen.queryByText(/token|secret|prompt/i)).not.toBeInTheDocument();
  });

  it('opens every read-only operating area from the primary navigation', () => {
    render(<Home />);

    for (const [area, heading] of [
      ['Community', 'Community pulse'],
      ['Broadcasts', 'Broadcast history'],
      ['Integrations', 'Connected systems'],
      ['Operations', 'Operational timeline'],
      ['Settings', 'Configuration posture'],
    ]) {
      fireEvent.click(screen.getByRole('button', { name: area }));
      expect(screen.getByRole('button', { name: area })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(
        screen.getByRole('heading', { name: heading }),
      ).toBeInTheDocument();
    }
  });

  it('documents bounded loading, empty, unavailable, and unauthorized states', () => {
    render(<Home />);
    fireEvent.click(screen.getByRole('button', { name: 'Operations' }));

    expect(screen.getByText('Loading snapshot')).toBeInTheDocument();
    expect(screen.getByText('No recent records')).toBeInTheDocument();
    expect(screen.getByText('Source unavailable')).toBeInTheDocument();
    expect(screen.getByText('Access restricted')).toBeInTheDocument();
  });

  it.each([
    ['loading', 'Loading snapshot'],
    ['empty', 'No recent records'],
    ['unavailable', 'Source unavailable'],
    ['unauthorized', 'Access restricted'],
  ] as const)('renders the %s runtime state', (state, message) => {
    render(<ResilientState state={state} />);
    expect(screen.getByText(message)).toBeInTheDocument();
  });
});

describe('Command Deck safe controls', () => {
  it('uses only a validated configured API origin instead of the deployed Sites origin', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(catalog)));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <SettingsControls apiBaseUrl="https://jarvis-tunnel.example.test" />,
    );
    unlockControls();
    await screen.findByText('Safe controls ready');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://jarvis-tunnel.example.test/api/v1/command-deck/config/catalog',
      expect.any(Object),
    );
  });

  it('fails closed when the configured API base is not approved', async () => {
    render(
      <SettingsControls apiBaseUrl="https://operator:password@evil.example" />,
    );
    unlockControls();
    expect(
      await screen.findByText(
        'Safe controls are unavailable until a valid API address is configured.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Preview broadcast change' }),
    ).toBeDisabled();
  });

  it('keeps write controls locked until an active-tab access code loads the real catalog', async () => {
    let resolveCatalog: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveCatalog = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsControls />);

    expect(screen.getByText(/^Controls locked\./)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Preview broadcast change' }),
    ).toBeDisabled();

    unlockControls();
    expect(screen.getByText('Loading safe controls')).toBeInTheDocument();
    resolveCatalog?.(jsonResponse(catalog));

    await screen.findByText('Safe controls ready');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/api/v1/command-deck/config/catalog',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          Authorization: 'Bearer write-only-token',
          'X-Command-Deck-Request-Id':
            expect.stringMatching(/^[0-9a-f-]{36}$/i),
          'X-Command-Deck-Timestamp': expect.any(String),
        }),
      }),
    );
  });

  it('previews every bounded control family through the versioned mutation route', async () => {
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (url.endsWith('/catalog'))
        return Promise.resolve(jsonResponse(catalog));
      if (url.endsWith('/cancel'))
        return Promise.resolve(jsonResponse({ cancelled: true }));
      const action = JSON.parse(String(options?.body)).action;
      return Promise.resolve(
        jsonResponse({
          schemaVersion: '1.0',
          preview: {
            ...preview,
            id: `preview-${action.type}`,
            target:
              action.type === 'broadcast_state'
                ? 'broadcast:daily'
                : action.type === 'feature_flag'
                  ? 'feature:trivia'
                  : 'rss:news.example.test',
            diff:
              action.type === 'rss_feed'
                ? {
                    before: undefined,
                    after: { url: action.url, label: action.label },
                  }
                : action.type === 'feature_flag'
                  ? { before: false, after: true }
                  : preview.diff,
          },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsControls />);
    unlockControls();
    await screen.findByText('Safe controls ready');

    fireEvent.click(
      screen.getByRole('button', { name: 'Preview broadcast change' }),
    );
    await screen.findByText('Before: enabled');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel preview' }));
    await screen.findByText('Preview cancelled. No change was sent.');

    fireEvent.click(
      screen.getByRole('button', { name: 'Preview feature change' }),
    );
    await screen.findByText('Before: disabled');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel preview' }));
    await screen.findByText('Preview cancelled. No change was sent.');

    fireEvent.change(screen.getByLabelText('RSS feed URL'), {
      target: { value: 'https://news.example.test/feed.xml' },
    });
    fireEvent.change(screen.getByLabelText('RSS feed label'), {
      target: { value: 'MuthaShip news' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview RSS change' }));
    await screen.findByText('Before: not configured');

    const previewCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/preview'),
    );
    expect(
      previewCalls.map(
        ([, options]) => JSON.parse(String(options?.body)).action,
      ),
    ).toEqual([
      { type: 'broadcast_state', category: 'daily', state: 'paused' },
      { type: 'feature_flag', feature: 'trivia', enabled: true },
      {
        type: 'rss_feed',
        operation: 'add',
        url: 'https://news.example.test/feed.xml',
        label: 'MuthaShip news',
      },
    ]);
  });

  it('previews removal of an existing catalog RSS feed without accepting a free-form target', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/catalog'))
        return Promise.resolve(
          jsonResponse({
            ...catalog,
            actions: {
              ...catalog.actions,
              rssFeeds: [
                {
                  id: 'rss_0123456789abcdef0123456789abcdef',
                  label: 'Existing feed',
                },
              ],
            },
          }),
        );
      return Promise.resolve(jsonResponse({ preview }));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsControls />);
    unlockControls();
    await screen.findByText('Safe controls ready');
    fireEvent.change(screen.getByLabelText('Existing RSS feed'), {
      target: { value: 'rss_0123456789abcdef0123456789abcdef' },
    });
    expect(
      screen.getByRole('button', { name: 'Preview RSS removal' }),
    ).toBeEnabled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview RSS removal' }),
    );
    await screen.findByText('Before: enabled');
    const [, options] = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith('/preview'),
    )!;
    expect(JSON.parse(String(options?.body)).action).toEqual({
      type: 'rss_feed',
      operation: 'remove',
      feedId: 'rss_0123456789abcdef0123456789abcdef',
    });
  });

  it('locks every preview family while a preview is in flight or awaiting confirmation', async () => {
    let resolvePreview: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/catalog'))
        return Promise.resolve(jsonResponse(catalog));
      return new Promise<Response>((resolve) => {
        resolvePreview = resolve;
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsControls />);
    unlockControls();
    await screen.findByText('Safe controls ready');
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview broadcast change' }),
    );
    expect(
      screen.getByRole('button', { name: 'Preview feature change' }),
    ).toBeDisabled();
    resolvePreview?.(jsonResponse({ preview }));
    await screen.findByRole('button', { name: 'Confirm change' });
    expect(
      screen.getByRole('button', { name: 'Preview RSS change' }),
    ).toBeDisabled();
  });

  it('re-locks and discards a pending preview after unauthorized write access', async () => {
    let calls = 0;
    const fetchMock = vi.fn((url: string) => {
      calls += 1;
      if (url.endsWith('/catalog'))
        return Promise.resolve(jsonResponse(catalog));
      if (calls === 2) return Promise.resolve(jsonResponse({ preview }));
      return Promise.resolve(
        jsonResponse({ error: { code: 'unauthorized' } }, 401),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsControls />);
    unlockControls();
    await screen.findByText('Safe controls ready');
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview broadcast change' }),
    );
    await screen.findByRole('button', { name: 'Confirm change' });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }));
    expect(
      await screen.findByText(
        'Access restricted. Check the active-tab write access code.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Change access code' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Confirm change' }),
    ).not.toBeInTheDocument();
  });

  it('retries a failed cancellation, then enables confirmation for a new preview', async () => {
    let previews = 0;
    let cancellations = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/catalog'))
        return Promise.resolve(jsonResponse(catalog));
      if (url.endsWith('/preview')) {
        previews += 1;
        return Promise.resolve(
          jsonResponse({ preview: { ...preview, id: `preview-${previews}` } }),
        );
      }
      if (url.endsWith('/cancel')) {
        cancellations += 1;
        return Promise.resolve(
          cancellations === 1
            ? jsonResponse(
                { error: { code: 'unavailable', message: 'cancel failed' } },
                503,
              )
            : jsonResponse({ cancelled: true }),
        );
      }
      return Promise.resolve(
        jsonResponse({
          receipt: {
            id: 'receipt',
            confirmedAt: '2026-08-23T00:00:00.000Z',
            target: 'broadcast:daily',
          },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsControls />);
    unlockControls();
    await screen.findByText('Safe controls ready');
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview broadcast change' }),
    );
    await screen.findByRole('button', { name: 'Cancel preview' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel preview' }));
    await screen.findByRole('button', { name: 'Retry cancellation' });
    expect(
      screen.getByRole('button', { name: 'Confirm change' }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry cancellation' }));
    await screen.findByText('Preview cancelled. No change was sent.');
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview broadcast change' }),
    );
    expect(
      await screen.findByRole('button', { name: 'Confirm change' }),
    ).toBeEnabled();
  });

  it('clears a stale confirmation preview instead of offering a dead retry', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/catalog'))
        return Promise.resolve(jsonResponse(catalog));
      if (url.endsWith('/preview'))
        return Promise.resolve(jsonResponse({ preview }));
      return Promise.resolve(
        jsonResponse({ error: { code: 'preview_stale' } }, 409),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsControls />);
    unlockControls();
    await screen.findByText('Safe controls ready');
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview broadcast change' }),
    );
    await screen.findByRole('button', { name: 'Confirm change' });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }));
    await screen.findByText(
      'Preview expired or changed. Create a new preview.',
    );
    expect(
      screen.queryByRole('button', { name: /confirm|cancel/i }),
    ).not.toBeInTheDocument();
  });

  it('distinguishes a permanent safe rejection from a retryable failure', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/catalog'))
        return Promise.resolve(jsonResponse(catalog));
      if (url.endsWith('/preview'))
        return Promise.resolve(jsonResponse({ preview }));
      return Promise.resolve(
        jsonResponse({ error: { code: 'invalid_action' } }, 400),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsControls />);
    unlockControls();
    await screen.findByText('Safe controls ready');
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview broadcast change' }),
    );
    await screen.findByRole('button', { name: 'Confirm change' });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }));
    expect(
      await screen.findByText(
        'Jarvis rejected this change. No retry is available.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry confirmation' }),
    ).not.toBeInTheDocument();
  });

  it('keeps a confirmation visibly in progress until Jarvis returns a receipt', async () => {
    let resolveConfirmation: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/catalog'))
        return Promise.resolve(jsonResponse(catalog));
      if (url.endsWith('/preview'))
        return Promise.resolve(jsonResponse({ preview }));
      return new Promise<Response>((resolve) => {
        resolveConfirmation = resolve;
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsControls />);
    unlockControls();
    await screen.findByText('Safe controls ready');
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview broadcast change' }),
    );
    await screen.findByRole('button', { name: 'Confirm change' });

    fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }));
    expect(
      await screen.findByText('Confirming with Jarvis. Do not close this tab.'),
    ).toBeInTheDocument();
    resolveConfirmation?.(
      jsonResponse({
        receipt: {
          id: 'receipt-pending',
          confirmedAt: '2026-08-23T17:56:00.000Z',
          target: 'broadcast:daily',
        },
      }),
    );
    expect(
      await screen.findByText('Change succeeded. Receipt: receipt-pending.'),
    ).toBeInTheDocument();
  });

  it('confirms once, retries a truthful failure with the same key, then offers compensating rollback', async () => {
    let confirmationAttempts = 0;
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (url.endsWith('/catalog'))
        return Promise.resolve(jsonResponse(catalog));
      if (url.endsWith('/preview'))
        return Promise.resolve(jsonResponse({ schemaVersion: '1.0', preview }));
      if (url.endsWith('/confirm')) {
        confirmationAttempts += 1;
        if (confirmationAttempts === 1)
          return Promise.resolve(
            jsonResponse(
              {
                error: {
                  code: 'apply_failed',
                  message:
                    'Jarvis could not apply this change. Retry the same confirmation.',
                },
              },
              503,
            ),
          );
        return Promise.resolve(
          jsonResponse({
            receipt: {
              id: 'receipt-1',
              confirmedAt: '2026-08-23T17:56:00.000Z',
              target: 'broadcast:daily',
              rollbackToken: 'rollback-1',
            },
          }),
        );
      }
      if (
        url.endsWith('/rollback') &&
        String(options?.body).includes('rollbackToken')
      )
        return Promise.resolve(
          jsonResponse({
            preview: {
              ...preview,
              id: 'rollback-preview-1',
              diff: { before: false, after: true },
            },
          }),
        );
      if (url.endsWith('/rollback'))
        return Promise.resolve(
          jsonResponse({
            receipt: {
              id: 'rollback-receipt-1',
              confirmedAt: '2026-08-23T17:57:00.000Z',
              target: 'broadcast:daily',
            },
          }),
        );
      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal('fetch', fetchMock);
    render(<SettingsControls />);
    unlockControls();
    await screen.findByText('Safe controls ready');
    fireEvent.click(
      screen.getByRole('button', { name: 'Preview broadcast change' }),
    );
    await screen.findByRole('button', { name: 'Confirm change' });

    fireEvent.click(screen.getByRole('button', { name: 'Confirm change' }));
    await screen.findByText(/could not apply this change/i);
    fireEvent.click(screen.getByRole('button', { name: 'Retry confirmation' }));
    await screen.findByText('Change succeeded. Receipt: receipt-1.');

    const confirmCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith('/confirm'),
    );
    expect(confirmCalls).toHaveLength(2);
    expect(
      confirmCalls.map(([, options]) =>
        new Headers(options?.headers).get('Idempotency-Key'),
      ),
    ).toEqual([expect.any(String), expect.any(String)]);
    expect(
      new Headers(confirmCalls[0][1]?.headers).get('Idempotency-Key'),
    ).toBe(new Headers(confirmCalls[1][1]?.headers).get('Idempotency-Key'));

    fireEvent.click(screen.getByRole('button', { name: 'Preview rollback' }));
    await screen.findByText('Rollback preview ready.');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rollback' }));
    await screen.findByText('Rollback succeeded.');
  });

  it.each([
    [401, 'Access restricted. Check the active-tab write access code.'],
    [409, 'Preview expired or changed. Create a new preview.'],
  ])(
    'renders an honest resilient outcome for API status %s',
    async (status, message) => {
      const fetchMock = vi.fn((url: string) => {
        if (url.endsWith('/catalog'))
          return Promise.resolve(
            status === 401
              ? jsonResponse({ error: { code: 'unauthorized' } }, 401)
              : jsonResponse(catalog),
          );
        return Promise.resolve(
          jsonResponse({ error: { code: 'preview_stale' } }, status),
        );
      });
      vi.stubGlobal('fetch', fetchMock);
      render(<SettingsControls />);
      unlockControls();

      if (status === 401) {
        expect(await screen.findByText(message)).toBeInTheDocument();
        return;
      }
      await screen.findByText('Safe controls ready');
      fireEvent.click(
        screen.getByRole('button', { name: 'Preview broadcast change' }),
      );
      expect(await screen.findByText(message)).toBeInTheDocument();
    },
  );
});
