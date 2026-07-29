import { caseFold } from 'unicode-case-folding';
import {
  pollDurationMilliseconds,
  type PollDurationValue,
} from './poll-duration.js';

const pollDurations = new Set<PollDurationValue>([
  '15m',
  '1h',
  '6h',
  '24h',
  '3d',
  '7d',
]);

const codePointLength = (value: string): number => Array.from(value).length;

const normalizeOptionForComparison = (value: string): string =>
  caseFold(value.normalize('NFKC'))
    .replace(/\p{White_Space}+/gu, ' ')
    .trim();

const validateText = (
  value: string,
  field: 'Question' | 'Option',
  maximumCodePoints: number,
): string => {
  const trimmed = value.trim();
  const length = codePointLength(trimmed);

  if (length < 1 || length > maximumCodePoints) {
    throw new Error(
      `${field} must be between 1 and ${maximumCodePoints} Unicode characters.`,
    );
  }

  return trimmed;
};

export const validatePollInput = (input: {
  readonly question: string;
  readonly options: readonly string[];
  readonly duration: string;
}): {
  readonly question: string;
  readonly options: readonly string[];
  readonly duration: PollDurationValue;
  readonly durationMs: number;
} => {
  const question = validateText(input.question, 'Question', 200);

  if (input.options.length < 2 || input.options.length > 5) {
    throw new Error('A poll must have between 2 and 5 options.');
  }

  const options = input.options.map((option) =>
    validateText(option, 'Option', 80),
  );
  const normalizedOptions = new Set(options.map(normalizeOptionForComparison));

  if (normalizedOptions.size !== options.length) {
    throw new Error('Poll options must be unique.');
  }

  if (!pollDurations.has(input.duration as PollDurationValue)) {
    throw new Error('Poll duration must be one of the registered presets.');
  }

  const duration = input.duration as PollDurationValue;

  return Object.freeze({
    question,
    options: Object.freeze(options),
    duration,
    durationMs: pollDurationMilliseconds(duration),
  });
};
