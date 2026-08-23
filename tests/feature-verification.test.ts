import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  renderFeatureVerificationReport,
  validateFeatureCatalog,
  type FeatureVerificationRecord,
} from '../src/platform/feature-verification.js';

const record = (
  overrides: Partial<FeatureVerificationRecord> = {},
): FeatureVerificationRecord => ({
  id: 'core-conversation',
  name: 'Core conversation',
  status: 'pass',
  ownerModule: 'src/services/conversation-service.ts',
  entryPoints: {
    discordCommands: ['ask'],
    commandDeckWorkflows: ['overview-service-health'],
  },
  audience: 'member',
  requiredConfiguration: ['DISCORD_TOKEN'],
  permissionBoundary: 'Visible to server members in allowed channels.',
  persistenceBehavior: 'Conversation history remains channel scoped.',
  automatedEvidence: ['tests/conversation-service.test.ts'],
  manualSmokeCases: [
    'Run /ask with a bounded prompt and verify Jarvis replies in context.',
  ],
  ...overrides,
});

const repositoryFixture = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'jarvis-feature-verification-'));
  await mkdir(join(root, 'src/services'), { recursive: true });
  await mkdir(join(root, 'tests'), { recursive: true });
  await writeFile(join(root, 'src/services/conversation-service.ts'), '');
  await writeFile(join(root, 'tests/conversation-service.test.ts'), '');
  return root;
};

describe('feature verification', () => {
  it('reports an unowned registered command', async () => {
    const result = await validateFeatureCatalog(
      [record()],
      [{ name: 'ask' }, { name: 'status' }],
      [{ id: 'overview-service-health' }],
      await repositoryFixture(),
    );

    expect(result.findings).toContainEqual({
      code: 'command-unowned',
      message: 'Registered Discord command /status has no feature owner.',
    });
    expect(result.shippable).toBe(false);
  });

  it('reports a command owned by more than one feature', async () => {
    const result = await validateFeatureCatalog(
      [
        record(),
        record({
          id: 'service-health',
          name: 'Service health',
          entryPoints: {
            discordCommands: ['ask'],
            commandDeckWorkflows: ['overview-service-health'],
          },
        }),
      ],
      [{ name: 'ask' }],
      [{ id: 'overview-service-health' }],
      await repositoryFixture(),
    );

    expect(result.findings).toContainEqual({
      code: 'command-duplicated',
      message:
        'Registered Discord command /ask is owned by multiple features: core-conversation, service-health.',
    });
  });

  it('reports evidence paths that do not exist', async () => {
    const result = await validateFeatureCatalog(
      [record({ automatedEvidence: ['tests/missing.test.ts'] })],
      [{ name: 'ask' }],
      [{ id: 'overview-service-health' }],
      await repositoryFixture(),
    );

    expect(result.findings).toContainEqual({
      code: 'evidence-missing',
      message:
        'Feature core-conversation cites missing evidence tests/missing.test.ts.',
    });
  });

  it('renders a deterministic report with evidence and smoke coverage', async () => {
    const result = await validateFeatureCatalog(
      [record()],
      [{ name: 'ask' }],
      [{ id: 'overview-service-health' }],
      await repositoryFixture(),
    );

    const report = renderFeatureVerificationReport(result);
    expect(report).toContain('# Jarvis shipped-feature verification matrix');
    expect(report).toContain('**Release readiness:** PASS');
    expect(report).toContain(
      '| Core conversation | pass | Member | `/ask` | overview-service-health |',
    );
    expect(report).toContain(
      '- Automated: `tests/conversation-service.test.ts`',
    );
    expect(report).toContain(
      '- Smoke: Run /ask with a bounded prompt and verify Jarvis replies in context.',
    );
  });

  it('reports missing and duplicate Command Deck workflow ownership', async () => {
    const result = await validateFeatureCatalog(
      [
        record({
          entryPoints: {
            discordCommands: ['ask'],
            commandDeckWorkflows: ['overview-service-health'],
          },
        }),
        record({
          id: 'duplicate-deck-owner',
          name: 'Duplicate Deck owner',
          entryPoints: {
            discordCommands: [],
            commandDeckWorkflows: ['overview-service-health'],
          },
        }),
      ],
      [{ name: 'ask' }],
      [{ id: 'overview-service-health' }, { id: 'rss-preview' }],
      await repositoryFixture(),
    );

    expect(result.findings).toEqual(
      expect.arrayContaining([
        {
          code: 'workflow-duplicated',
          message:
            'Command Deck workflow overview-service-health is owned by multiple features: core-conversation, duplicate-deck-owner.',
        },
        {
          code: 'workflow-unowned',
          message: 'Command Deck workflow rss-preview has no feature owner.',
        },
      ]),
    );
  });

  it('rejects evidence outside the repository or outside the test inventory', async () => {
    const root = await repositoryFixture();
    const result = await validateFeatureCatalog(
      [
        record({
          automatedEvidence: [
            '../outside.test.ts',
            'src/services/conversation-service.ts',
          ],
        }),
      ],
      [{ name: 'ask' }],
      [{ id: 'overview-service-health' }],
      root,
    );

    expect(result.findings).toEqual(
      expect.arrayContaining([
        {
          code: 'evidence-invalid',
          message:
            'Feature core-conversation cites evidence outside the repository: ../outside.test.ts.',
        },
        {
          code: 'evidence-invalid',
          message:
            'Feature core-conversation evidence is not a Vitest test file: src/services/conversation-service.ts.',
        },
      ]),
    );
  });

  it('rejects malformed configuration keys and live not-applicable records', async () => {
    const result = await validateFeatureCatalog(
      [
        record({
          status: 'not-applicable',
          requiredConfiguration: ['discord token'],
        }),
      ],
      [{ name: 'ask' }],
      [{ id: 'overview-service-health' }],
      await repositoryFixture(),
    );

    expect(result.findings).toEqual(
      expect.arrayContaining([
        {
          code: 'configuration-invalid',
          message:
            'Feature core-conversation has invalid configuration key discord token.',
        },
        {
          code: 'status-invalid',
          message:
            'Feature core-conversation is not-applicable but owns runtime entry points.',
        },
      ]),
    );
    expect(result.shippable).toBe(false);
  });
});
