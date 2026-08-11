import { readFile } from 'node:fs/promises';
import { z } from 'zod';

export interface ProactivePrompt {
  readonly id: string;
  readonly category: string;
  readonly text: string;
  readonly active: boolean;
  readonly startsAt?: Date;
  readonly endsAt?: Date;
}

const invalidCatalogMessage =
  'Invalid proactive catalog configuration: ENGAGEMENT_PROACTIVE_CATALOG_PATH';
const unsafeMentionPattern = /@(everyone|here)\b|<@&\d+>/i;

const rawPromptSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    category: z.string().trim().min(1).max(64),
    text: z.string().trim().min(1).max(1_000),
    active: z.boolean(),
    startsAt: z.string().datetime({ offset: true }).optional(),
    endsAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

const rawCatalogSchema = z.array(rawPromptSchema).max(100);

export const loadProactiveCatalog = async (
  path: string,
): Promise<readonly ProactivePrompt[]> => {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error(invalidCatalogMessage);
  }

  return buildProactiveCatalog(raw);
};

export const buildProactiveCatalog = (
  raw: unknown,
): readonly ProactivePrompt[] => {
  const entries = rawCatalogSchema.parse(raw);
  const ids = new Set<string>();

  const prompts = entries.map((entry) => {
    if (unsafeMentionPattern.test(entry.text)) {
      throw new Error(
        'Proactive catalog prompts cannot contain Discord mentions.',
      );
    }
    if (ids.has(entry.id)) {
      throw new Error('Proactive catalog contains a duplicate prompt ID.');
    }
    ids.add(entry.id);

    const startsAt =
      entry.startsAt === undefined ? undefined : new Date(entry.startsAt);
    const endsAt =
      entry.endsAt === undefined ? undefined : new Date(entry.endsAt);
    if (startsAt !== undefined && endsAt !== undefined && startsAt >= endsAt) {
      throw new Error('A proactive prompt start must be before its end.');
    }

    return Object.freeze({
      id: entry.id,
      category: entry.category,
      text: entry.text,
      active: entry.active,
      ...(startsAt === undefined ? {} : { startsAt }),
      ...(endsAt === undefined ? {} : { endsAt }),
    });
  });

  return Object.freeze(prompts);
};

export const selectEligiblePrompts = (
  catalog: readonly ProactivePrompt[],
  now: Date,
): readonly ProactivePrompt[] =>
  catalog.filter(
    (prompt) =>
      prompt.active &&
      (prompt.startsAt === undefined || prompt.startsAt <= now) &&
      (prompt.endsAt === undefined || now < prompt.endsAt),
  );
