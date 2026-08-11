import { readFile } from 'node:fs/promises';
import { z } from 'zod';

export interface ApprovedKnowledgeEntry {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly source: string;
  readonly approved: boolean;
  readonly updatedAt: string;
  readonly retentionDays?: number | undefined;
}

export interface KnowledgeResult {
  readonly id: string;
  readonly title: string;
  readonly content: string;
  readonly source: string;
  readonly updatedAt: string;
}

export interface ApprovedKnowledgeCatalog {
  readonly entries: readonly ApprovedKnowledgeEntry[];
  search(query: string): readonly KnowledgeResult[];
  get(id: string): KnowledgeResult | undefined;
}

const knowledgeTokens = (value: string): readonly string[] =>
  value
    .toLocaleLowerCase('en-US')
    .normalize('NFKC')
    .match(/[\p{L}\p{N}]{2,}/gu) ?? [];

export const rankKnowledgeResults = (
  entries: readonly KnowledgeResult[],
  query: string,
): readonly KnowledgeResult[] => {
  const queryTokens = [...new Set(knowledgeTokens(query))];
  if (queryTokens.length === 0) return [];
  const tokenMatches = (candidate: string, token: string): boolean =>
    candidate === token ||
    (token.length >= 4 && candidate.startsWith(token)) ||
    (candidate.length >= 4 && token.startsWith(candidate));
  return entries
    .map((entry, index) => {
      const titleTokens = knowledgeTokens(entry.title);
      const contentTokens = knowledgeTokens(entry.content);
      const score = queryTokens.reduce((total, token) => {
        const titleMatch = titleTokens.some((candidate) =>
          tokenMatches(candidate, token),
        );
        const contentMatch = contentTokens.some((candidate) =>
          tokenMatches(candidate, token),
        );
        return (
          total +
          (titleMatch || contentMatch ? 10 : 0) +
          (titleMatch ? 3 : 0) +
          (contentMatch ? 1 : 0)
        );
      }, 0);
      return { entry, index, score };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 5)
    .map(({ entry }) => entry);
};

const secretPattern = /(?:sk|tvly|xox[baprs]|gh[pousr])-[A-Za-z0-9_-]{12,}/gi;
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const mentionPattern = /@(everyone|here|[!&]?\d{15,22})/gi;

export const redactKnowledgeText = (value: string): string =>
  value
    .replace(secretPattern, '[REDACTED]')
    .replace(emailPattern, '[REDACTED]')
    .replace(mentionPattern, '[REDACTED]');

const entrySchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z0-9-]+$/),
    title: z.string().trim().min(1).max(120),
    content: z.string().trim().min(1).max(8_000),
    source: z.string().trim().min(1).max(200),
    approved: z.boolean(),
    updatedAt: z.string().datetime({ offset: true }),
    retentionDays: z.number().int().min(1).max(3650).optional(),
  })
  .strict();

export const knowledgeEntriesSchema = z.array(entrySchema).max(500);

export const loadKnowledgeCatalog = async (
  path: string,
): Promise<ApprovedKnowledgeCatalog> =>
  buildKnowledgeCatalog(
    JSON.parse(await readFile(path, 'utf8')) as readonly unknown[],
  );

const isActive = (entry: ApprovedKnowledgeEntry, now: Date): boolean => {
  if (!entry.approved) return false;
  if (entry.retentionDays === undefined) return true;
  const age = now.getTime() - new Date(entry.updatedAt).getTime();
  return age <= entry.retentionDays * 24 * 60 * 60 * 1000;
};

export const buildKnowledgeCatalog = (
  rawEntries: readonly unknown[],
  now = new Date(),
): ApprovedKnowledgeCatalog => {
  const parsed = knowledgeEntriesSchema.parse(rawEntries);
  const entries = parsed.map((entry) =>
    Object.freeze({
      ...entry,
      content: redactKnowledgeText(entry.content),
    }),
  );
  const active = entries.filter((entry) => isActive(entry, now));
  const byId = new Map(active.map((entry) => [entry.id, entry]));
  const toResult = (entry: ApprovedKnowledgeEntry): KnowledgeResult => ({
    id: entry.id,
    title: entry.title,
    content: entry.content,
    source: entry.source,
    updatedAt: entry.updatedAt,
  });
  return Object.freeze({
    entries: Object.freeze(entries),
    get: (id: string) => {
      const entry = byId.get(id.trim().toLowerCase());
      return entry ? toResult(entry) : undefined;
    },
    search: (query: string) =>
      rankKnowledgeResults(active.map(toResult), query),
  });
};
