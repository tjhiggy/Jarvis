// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import Home, { ResilientState } from './page';
import {
  commandDeckFixture,
  getCommandDeckSnapshot,
  getOverallSummary,
  getSnapshotFreshness,
  validateCommandDeckSnapshot,
} from './lib/command-deck';

afterEach(cleanup);

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
});

describe('Command Deck overview', () => {
  it('renders the MuthaShip operations shell as read-only', () => {
    render(<Home />);

    expect(
      screen.getByRole('heading', { name: /command deck/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/read-only operations view/i)).toBeInTheDocument();
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
