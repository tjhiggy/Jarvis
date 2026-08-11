import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  loadProactiveCatalog,
  selectEligiblePrompts,
  type ProactivePrompt,
} from '../src/notifications/proactive-catalog.js';

const prompt = (overrides: Partial<ProactivePrompt> = {}): ProactivePrompt => ({
  id: 'ready',
  category: 'crew-check-in',
  text: 'Crew check-in: what is everyone playing today?',
  active: true,
  ...overrides,
});

const catalogFile = async (value: unknown): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-proactive-catalog-'));
  const path = join(directory, 'prompts.json');
  await writeFile(path, JSON.stringify(value), 'utf8');
  return path;
};

describe('approved proactive prompt catalog', () => {
  it('rejects a missing or malformed catalog', async () => {
    await expect(loadProactiveCatalog('missing-prompts.json')).rejects.toThrow(
      /catalog/i,
    );
    await expect(
      loadProactiveCatalog(await catalogFile({ prompts: [prompt()] })),
    ).rejects.toThrow(/array/i);
  });

  it('rejects mass mentions, role mentions, duplicate IDs, and more than one hundred prompts', async () => {
    await expect(
      loadProactiveCatalog(
        await catalogFile([prompt({ text: '@everyone check in' })]),
      ),
    ).rejects.toThrow(/mention/i);
    await expect(
      loadProactiveCatalog(
        await catalogFile([prompt({ text: '<@&12345678901234567>' })]),
      ),
    ).rejects.toThrow(/mention/i);
    await expect(
      loadProactiveCatalog(await catalogFile([prompt(), prompt()])),
    ).rejects.toThrow(/duplicate/i);
    await expect(
      loadProactiveCatalog(
        await catalogFile(
          Array.from({ length: 101 }, (_, index) =>
            prompt({ id: `prompt-${index}` }),
          ),
        ),
      ),
    ).rejects.toThrow(/100/);
  });

  it('rejects invalid prompt windows', async () => {
    await expect(
      loadProactiveCatalog(
        await catalogFile([
          prompt({
            startsAt: new Date('2026-08-12T00:00:00Z'),
            endsAt: new Date('2026-08-11T00:00:00Z'),
          }),
        ]),
      ),
    ).rejects.toThrow(/start.*before.*end/i);
  });

  it('selects only active prompts inside their date window', () => {
    const catalog: readonly ProactivePrompt[] = [
      prompt(),
      prompt({ id: 'inactive', active: false }),
      prompt({ id: 'not-yet', startsAt: new Date('2026-08-12T00:00:00Z') }),
      prompt({ id: 'expired', endsAt: new Date('2026-08-10T00:00:00Z') }),
    ];

    expect(
      selectEligiblePrompts(catalog, new Date('2026-08-11T12:00:00Z')).map(
        (item) => item.id,
      ),
    ).toEqual(['ready']);
  });
});
