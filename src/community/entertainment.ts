export type EntertainmentKind =
  'challenge' | 'prediction' | 'quote' | 'throwback' | 'roast' | 'meme';

export interface EntertainmentItem {
  readonly id: string;
  readonly kind: EntertainmentKind;
  readonly title: string;
  readonly prompt: string;
  readonly enabled: boolean;
}

export interface EntertainmentCatalog {
  readonly items: readonly EntertainmentItem[];
  readonly enabledKinds: readonly EntertainmentKind[];
}

const allowedKinds: readonly EntertainmentKind[] = [
  'challenge',
  'prediction',
  'quote',
  'throwback',
  'roast',
  'meme',
];
const bounded = (value: string): string => value.trim().slice(0, 500);

export const buildEntertainmentCatalog = (
  items: readonly EntertainmentItem[],
): EntertainmentCatalog => {
  const safe = items
    .slice(0, 100)
    .filter(
      (item) =>
        allowedKinds.includes(item.kind) &&
        item.id.length > 0 &&
        bounded(item.title).length > 0 &&
        bounded(item.prompt).length > 0,
    )
    .map((item) => ({
      ...item,
      title: bounded(item.title),
      prompt: bounded(item.prompt),
      enabled: Boolean(item.enabled),
    }));
  return {
    items: safe,
    enabledKinds: [
      ...new Set(safe.filter((item) => item.enabled).map((item) => item.kind)),
    ],
  };
};
