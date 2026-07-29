import { readFile } from 'node:fs/promises';
import { z } from 'zod';

export interface FaqEntry {
  readonly id: string;
  readonly label: string;
  readonly question: string;
  readonly answer: string;
}

export interface FaqCatalog {
  readonly entries: readonly FaqEntry[];
  get(id: string): FaqEntry | undefined;
}

const invalidCatalogMessage =
  'Invalid FAQ catalog configuration: FAQ_CATALOG_PATH';
const prohibitedCharacters = new Set(['\0', '\u2028', '\u2029']);

function trustedString(maximumLength: number) {
  return z
    .string()
    .min(1)
    .max(maximumLength)
    .refine((value) => value === value.trim())
    .refine((value) =>
      [...value].every((character) => !prohibitedCharacters.has(character)),
    );
}

const faqEntrySchema = z
  .object({
    id: trustedString(32).regex(/^[a-z0-9-]+$/),
    label: trustedString(100),
    question: trustedString(200),
    answer: trustedString(1800),
  })
  .strict();

const faqCatalogSchema = z.array(faqEntrySchema).min(1).max(25);

export const loadFaqCatalog = async (path: string): Promise<FaqCatalog> => {
  try {
    const parsed = faqCatalogSchema.parse(
      JSON.parse(await readFile(path, 'utf8')),
    );
    const entries = parsed.map((entry) => Object.freeze({ ...entry }));
    const entriesById = new Map<string, FaqEntry>();

    for (const entry of entries) {
      const normalizedId = entry.id.toLowerCase();
      if (entriesById.has(normalizedId)) {
        throw new Error('duplicate FAQ ID');
      }
      entriesById.set(normalizedId, entry);
    }

    const catalog: FaqCatalog = {
      entries: Object.freeze(entries),
      get(id: string): FaqEntry | undefined {
        return entriesById.get(id.trim().toLowerCase());
      },
    };

    return Object.freeze(catalog);
  } catch {
    throw new Error(invalidCatalogMessage);
  }
};
