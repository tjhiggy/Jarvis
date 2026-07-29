export type PollDurationValue = '15m' | '1h' | '6h' | '24h' | '3d' | '7d';

export const pollDurationChoices: readonly {
  readonly name: string;
  readonly value: PollDurationValue;
}[] = Object.freeze([
  { name: '15 minutes', value: '15m' },
  { name: '1 hour', value: '1h' },
  { name: '6 hours', value: '6h' },
  { name: '24 hours', value: '24h' },
  { name: '3 days', value: '3d' },
  { name: '7 days', value: '7d' },
]);

const durationMilliseconds: Readonly<Record<PollDurationValue, number>> = {
  '15m': 900_000,
  '1h': 3_600_000,
  '6h': 21_600_000,
  '24h': 86_400_000,
  '3d': 259_200_000,
  '7d': 604_800_000,
};

export const pollDurationMilliseconds = (value: PollDurationValue): number =>
  durationMilliseconds[value];
