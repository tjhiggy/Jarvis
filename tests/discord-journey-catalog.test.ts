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
  it('owns the actual 36-command registration surface exactly once', () => {
    expect(registered).toHaveLength(36);
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
});
