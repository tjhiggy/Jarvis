// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import Home from './page';
import {
  commandDeckFixture,
  validateCommandDeckSnapshot,
} from './lib/command-deck';

afterEach(cleanup);

describe('Command Deck snapshot contract', () => {
  it('accepts the versioned safe fixture', () => {
    expect(validateCommandDeckSnapshot(commandDeckFixture)).toEqual(
      commandDeckFixture,
    );
  });

  it('rejects unsupported contract versions', () => {
    expect(() =>
      validateCommandDeckSnapshot({
        ...commandDeckFixture,
        contractVersion: '2.0',
      }),
    ).toThrow(/contract version/i);
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

    expect(screen.getByText(/attention needed/i)).toBeInTheDocument();
    expect(screen.getByText(/last updated 8 minutes ago/i)).toBeInTheDocument();
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
});
