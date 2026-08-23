import { describe, expect, it } from 'vitest';
import { createCommandDefinitions } from '../src/commands/definitions.js';
import {
  renderDiscordJourneyMatrix,
  normalizeDiscordJourneyMatrix,
  validateDiscordJourneys,
  type DiscordJourney,
} from '../src/platform/discord-journey-verification.js';

const root = new URL('../', import.meta.url);
const commandNames = createCommandDefinitions(
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
).map((command) => command.name);

const valid: DiscordJourney[] = commandNames.map((command) => ({
  id: `command-${command}`,
  kind: 'command',
  command,
  entryPoint: `/${command}`,
  state: 'available',
  visibility: 'private',
  configuration: 'No production configuration is read by this evidence.',
  permission: 'Discord invocation and server policy are enforced.',
  evidence: {
    registration: 'tests/register-commands.test.ts',
    routing: 'tests/commands.test.ts',
    visibility: 'tests/commands.test.ts',
    state: 'tests/commands.test.ts',
    permission: 'tests/command-permissions.test.ts',
  },
  outcome: 'verified-automated',
  manualObligation: 'Live registration and mobile rendering remain manual.',
}));

describe('Discord journey validation', () => {
  it('normalizes CRLF matrices before drift comparison', () => {
    expect(normalizeDiscordJourneyMatrix('one\r\ntwo\r\n')).toBe('one\ntwo\n');
  });
  it('accepts exactly one ownership row for every registered command', () => {
    expect(() =>
      validateDiscordJourneys(valid, commandNames, root),
    ).not.toThrow();
  });

  it('rejects a registered command without journey ownership', () => {
    expect(() =>
      validateDiscordJourneys(valid.slice(1), commandNames, root),
    ).toThrow(/missing registered command/i);
  });

  it('rejects duplicate command ownership', () => {
    expect(() =>
      validateDiscordJourneys([...valid, valid[0]!], commandNames, root),
    ).toThrow(/duplicate journey id|duplicate command/i);
  });

  it('requires registration, routing, visibility, state, permission, and evidence fields', () => {
    const broken = { ...valid[0]!, permission: ' ' };
    expect(() =>
      validateDiscordJourneys([broken, ...valid.slice(1)], commandNames, root),
    ).toThrow(/permission/i);
  });

  it('rejects command ownership without evidence for every command obligation', () => {
    const broken = {
      ...valid[0]!,
      evidence: { ...valid[0]!.evidence, routing: ' ' },
    };
    expect(() =>
      validateDiscordJourneys([broken, ...valid.slice(1)], commandNames, root),
    ).toThrow(/routing evidence/i);
  });

  it('requires non-automated outcomes to explain their obligation or defect', () => {
    const broken = {
      ...valid[0]!,
      outcome: 'manual-required' as const,
      manualObligation: ' ',
    };
    expect(() =>
      validateDiscordJourneys([broken, ...valid.slice(1)], commandNames, root),
    ).toThrow(/manual obligation/i);
  });

  it('renders deterministically without raw paths', () => {
    const first = renderDiscordJourneyMatrix(valid, commandNames, root);
    expect(first).toBe(renderDiscordJourneyMatrix(valid, commandNames, root));
    expect(first).toContain('# Discord Journey Verification Matrix');
    expect(first).toContain('routing: `tests/commands.test.ts`');
    expect(first).not.toMatch(/[A-Z]:\\|\/Users\//);
  });

  it('labels file references as supporting regressions instead of exact obligation proof', () => {
    const matrix = renderDiscordJourneyMatrix(valid, commandNames, root);
    expect(matrix).toContain('Supporting regression files');
    expect(matrix).toContain('not exact per-obligation proof');
  });
});
