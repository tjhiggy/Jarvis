import { describe, expect, it } from 'vitest';
import { createCommandDefinitions } from '../src/commands/definitions.js';
import {
  discordJourneyCatalog,
  publishedDiscordCommandNames,
} from '../src/platform/discord-journey-catalog.js';
import { validateDiscordJourneys } from '../src/platform/discord-journey-verification.js';

const root = new URL('../', import.meta.url);
const registered = createCommandDefinitions(
  2_000,
  [
    {
      id: 'capabilities',
      label: 'Capabilities',
      question: 'What can Jarvis do?',
      answer: 'Synthetic answer.',
    },
  ],
  true,
).map((definition) => definition.name);

describe('canonical Discord journey catalog', () => {
  it('owns the actual 38-command registration surface exactly once', () => {
    expect(registered).toHaveLength(38);
    expect(publishedDiscordCommandNames).toEqual(registered);
    expect(() =>
      validateDiscordJourneys(discordJourneyCatalog, registered, root),
    ).not.toThrow();
  });

  it('keeps GitHub feature intake outside Jarvis command registration', () => {
    expect(registered).not.toContain('feature-request');
    expect(discordJourneyCatalog).toContainEqual(
      expect.objectContaining({
        id: 'retired-feature-request-write-surface',
        outcome: 'not-applicable',
      }),
    );
  });

  it('owns feature, state, configuration, manual, and safety obligations', () => {
    expect(
      new Set(discordJourneyCatalog.map((journey) => journey.kind)),
    ).toEqual(
      new Set([
        'command',
        'feature',
        'state',
        'configuration',
        'manual',
        'safety',
      ]),
    );
  });

  it('does not claim exact automated command proof from file-level supporting regressions', () => {
    const commands = discordJourneyCatalog.filter(
      (journey) => journey.kind === 'command',
    );

    expect(commands).toHaveLength(38);
    expect(
      commands.every((journey) => journey.outcome !== 'verified-automated'),
    ).toBe(true);
    expect(
      commands.every((journey) =>
        journey.permission.includes('not command-specific proof'),
      ),
    ).toBe(true);
    expect(
      commands.every((journey) => journey.manualObligation?.trim()),
    ).toBeTruthy();
  });

  it('states the verifier boundary without claiming filesystem, network, env-file, or database isolation', () => {
    const safety = discordJourneyCatalog.find(
      (journey) => journey.id === 'safety-content-secrets-identifiers',
    );

    expect(safety?.configuration).toContain(
      'Inherited Discord and provider credentials are removed',
    );
    expect(safety?.configuration).toContain(
      'does not sandbox filesystem or network access',
    );
    expect(safety?.configuration).not.toMatch(/production database|\.env/i);
    expect(safety?.outcome).not.toBe('verified-automated');
  });
});
