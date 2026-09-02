import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createCommandDefinitions } from '../src/commands/definitions.js';
import { adminConsoleWorkflows } from '../src/admin/admin-console-workflows.js';
import { validateFeatureCatalog } from '../src/platform/feature-verification.js';
import { shippedFeatureCatalog } from '../src/platform/shipped-feature-catalog.js';

const faqFixture = [
  {
    id: 'about',
    label: 'About',
    question: 'What is Jarvis?',
    answer: 'Jarvis.',
  },
];

describe('shipped feature catalog', () => {
  it('owns every registered Discord command exactly once with real evidence', async () => {
    const commands = createCommandDefinitions(2_000, faqFixture, true);
    const result = await validateFeatureCatalog(
      shippedFeatureCatalog,
      commands,
      adminConsoleWorkflows,
      resolve('.'),
    );

    expect(commands).toHaveLength(38);
    expect(result.registeredCommandCount).toBe(38);
    expect(result.ownedCommandCount).toBe(38);
    expect(result.registeredWorkflowCount).toBe(adminConsoleWorkflows.length);
    expect(result.ownedWorkflowCount).toBe(adminConsoleWorkflows.length);
    expect(result.findings).toEqual([]);
    expect(result.shippable).toBe(true);
  });

  it('uses unique feature IDs and records smoke evidence for every feature', () => {
    const ids = shippedFeatureCatalog.map(({ id }) => id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(
      shippedFeatureCatalog.every(
        ({ automatedEvidence, manualSmokeCases }) =>
          automatedEvidence.length > 0 && manualSmokeCases.length > 0,
      ),
    ).toBe(true);
  });
});
