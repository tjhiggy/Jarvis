import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadFaqCatalog } from '../src/faq/faq-catalog.js';

const loaderError = 'Invalid FAQ catalog configuration: FAQ_CATALOG_PATH';

const validEntry = {
  id: 'capabilities',
  label: 'Jarvis capabilities',
  question: 'What can Jarvis do?',
  answer: 'Jarvis provides approved, local answers for the crew.',
};

const validCatalog = Array.from({ length: 9 }, (_, index) => ({
  ...validEntry,
  id: `topic-${index + 1}`,
  label: `Topic ${index + 1}`,
  question: `What is topic ${index + 1}?`,
}));

const temporaryDirectories: string[] = [];

async function writeCatalog(value: unknown): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'jarvis-faq-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'faq.json');
  await writeFile(path, JSON.stringify(value), 'utf8');
  return path;
}

async function expectInvalidCatalog(value: unknown): Promise<void> {
  const path = await writeCatalog(value);

  await expect(loadFaqCatalog(path)).rejects.toThrow(
    new RegExp(`^${loaderError}$`),
  );
  await expect(loadFaqCatalog(path)).rejects.not.toThrow(path);
  await expect(loadFaqCatalog(path)).rejects.not.toThrow(validEntry.answer);
  await expect(loadFaqCatalog(path)).rejects.not.toThrow('ZodError');
  await expect(loadFaqCatalog(path)).rejects.not.toThrow('faq.json');
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true })),
  );
});

describe('loadFaqCatalog', () => {
  it('loads nine approved entries with defensive case-insensitive lookup', async () => {
    const catalog = await loadFaqCatalog(await writeCatalog(validCatalog));

    expect(catalog.entries).toHaveLength(9);
    expect(catalog.get(' TOPIC-1 ')).toEqual(validCatalog[0]);
    expect(catalog.get('not-a-topic')).toBeUndefined();
  });

  it('exposes immutable catalog objects and copied entries', async () => {
    const source = structuredClone(validCatalog);
    const catalog = await loadFaqCatalog(await writeCatalog(source));

    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Object.isFrozen(catalog.entries)).toBe(true);
    expect(Object.isFrozen(catalog.entries[0])).toBe(true);
    expect(() =>
      (catalog.entries as unknown as FaqEntry[]).push(validEntry),
    ).toThrow(TypeError);
    expect(() => {
      (catalog.entries[0] as { answer: string }).answer = 'tampered';
    }).toThrow(TypeError);
    source[0]!.answer = 'changed after load';
    expect(catalog.get('topic-1')?.answer).toBe(validEntry.answer);
  });

  it.each([
    ['non-array root', { entry: validEntry }],
    ['zero entries', []],
    ['too many entries', Array.from({ length: 26 }, () => validEntry)],
    ['non-object entry', ['not an entry']],
    ['unknown field', [{ ...validEntry, extra: 'nope' }]],
    [
      'missing field',
      [
        {
          id: validEntry.id,
          label: validEntry.label,
          question: validEntry.question,
        },
      ],
    ],
    ['non-string field', [{ ...validEntry, answer: 1 }]],
    ['leading whitespace', [{ ...validEntry, label: ' Jarvis capabilities' }]],
    [
      'trailing whitespace',
      [{ ...validEntry, question: 'What can Jarvis do? ' }],
    ],
    ['duplicate normalized IDs', [{ ...validEntry }, { ...validEntry }]],
    ['empty ID', [{ ...validEntry, id: '' }]],
    ['invalid ID characters', [{ ...validEntry, id: 'not_valid' }]],
    ['ID longer than 32 characters', [{ ...validEntry, id: 'a'.repeat(33) }]],
    ['empty label', [{ ...validEntry, label: '' }]],
    [
      'label longer than 100 characters',
      [{ ...validEntry, label: 'a'.repeat(101) }],
    ],
    ['empty question', [{ ...validEntry, question: '' }]],
    [
      'question longer than 200 characters',
      [{ ...validEntry, question: 'a'.repeat(201) }],
    ],
    ['empty answer', [{ ...validEntry, answer: '' }]],
    [
      'answer longer than 1800 characters',
      [{ ...validEntry, answer: 'a'.repeat(1801) }],
    ],
    ['NUL character', [{ ...validEntry, answer: 'no\u0000thanks' }]],
    ['line separator', [{ ...validEntry, answer: 'no\u2028thanks' }]],
    ['paragraph separator', [{ ...validEntry, answer: 'no\u2029thanks' }]],
  ])('rejects %s without leaking catalog details', async (_name, value) => {
    await expectInvalidCatalog(value);
  });

  it('sanitizes malformed JSON and unreadable paths', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-faq-'));
    temporaryDirectories.push(directory);
    const malformedPath = join(directory, 'malformed.json');
    const missingPath = join(directory, 'missing.json');
    await writeFile(malformedPath, '{ secret parser failure', 'utf8');

    await expect(loadFaqCatalog(malformedPath)).rejects.toThrow(
      new RegExp(`^${loaderError}$`),
    );
    await expect(loadFaqCatalog(malformedPath)).rejects.not.toThrow(
      malformedPath,
    );
    await expect(loadFaqCatalog(malformedPath)).rejects.not.toThrow(
      'secret parser failure',
    );
    await expect(loadFaqCatalog(missingPath)).rejects.toThrow(
      new RegExp(`^${loaderError}$`),
    );
    await expect(loadFaqCatalog(missingPath)).rejects.not.toThrow(missingPath);
  });
});

interface FaqEntry {
  answer: string;
}
