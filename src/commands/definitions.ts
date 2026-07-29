import type { FaqEntry } from '../faq/faq-catalog.js';
import { pollDurationChoices } from '../polls/poll-duration.js';

interface InputCommandOptionDefinition {
  readonly type: 3;
  readonly name: 'prompt' | 'query';
  readonly description: string;
  readonly required: true;
  readonly max_length: number;
}

interface FaqTopicOptionDefinition {
  readonly type: 3;
  readonly name: 'topic';
  readonly description: string;
  readonly required: false;
  readonly choices: readonly {
    readonly name: string;
    readonly value: string;
  }[];
}

interface RequiredStringOptionDefinition {
  readonly type: 3;
  readonly name:
    'prompt' | 'query' | 'question' | 'option1' | 'option2' | 'poll_id';
  readonly description: string;
  readonly required: true;
  readonly max_length: number;
}

interface OptionalPollOptionDefinition {
  readonly type: 3;
  readonly name: 'option3' | 'option4' | 'option5';
  readonly description: string;
  readonly required: false;
  readonly max_length: number;
}

interface PollDurationOptionDefinition {
  readonly type: 3;
  readonly name: 'duration';
  readonly description: string;
  readonly required: true;
  readonly choices: typeof pollDurationChoices;
}

export type CommandOptionDefinition =
  | InputCommandOptionDefinition
  | FaqTopicOptionDefinition
  | RequiredStringOptionDefinition
  | OptionalPollOptionDefinition
  | PollDurationOptionDefinition;

export interface CommandDefinition {
  readonly type: 1;
  readonly name:
    | 'ask'
    | 'search'
    | 'forget'
    | 'help'
    | 'status'
    | 'faq'
    | 'poll'
    | 'poll-close';
  readonly description: string;
  readonly options?: readonly CommandOptionDefinition[];
}

const discordStringOptionMaxLength = 6_000;

export const createCommandDefinitions = (
  maxInputChars: number,
  faqEntries: readonly FaqEntry[],
  pollsEnabled = false,
): readonly CommandDefinition[] => {
  if (!Number.isSafeInteger(maxInputChars) || maxInputChars < 1) {
    throw new RangeError(
      'Command prompt maximum must be a positive safe integer.',
    );
  }

  if (faqEntries.length < 1 || faqEntries.length > 25) {
    throw new RangeError(
      'FAQ command choices must contain between 1 and 25 entries.',
    );
  }

  const definitions: CommandDefinition[] = [
    {
      type: 1,
      name: 'ask',
      description: 'Ask Jarvis a question in this conversation.',
      options: [
        {
          type: 3,
          name: 'prompt',
          description: 'The question to ask.',
          required: true,
          max_length: Math.min(maxInputChars, discordStringOptionMaxLength),
        },
      ],
    },
    {
      type: 1,
      name: 'search',
      description: 'Search current web sources and ask Jarvis.',
      options: [
        {
          type: 3,
          name: 'query',
          description: 'The current information to search for.',
          required: true,
          max_length: Math.min(maxInputChars, discordStringOptionMaxLength),
        },
      ],
    },
    {
      type: 1,
      name: 'forget',
      description:
        'Clear Jarvis conversation history in this channel or thread.',
    },
    {
      type: 1,
      name: 'help',
      description: 'Show the available Jarvis commands.',
    },
    {
      type: 1,
      name: 'status',
      description: 'Show safe service configuration and database status.',
    },
    {
      type: 1,
      name: 'faq',
      description: 'Browse approved Jarvis information.',
      options: [
        {
          type: 3,
          name: 'topic',
          description: 'Choose an approved Jarvis topic.',
          required: false,
          choices: faqEntries.map(({ id, label }) => ({
            name: label,
            value: id,
          })),
        },
      ],
    },
  ];

  if (pollsEnabled) {
    definitions.push(
      {
        type: 1,
        name: 'poll',
        description: 'Create an anonymous poll with live totals.',
        options: [
          {
            type: 3,
            name: 'question',
            description: 'The poll question.',
            required: true,
            max_length: 200,
          },
          {
            type: 3,
            name: 'option1',
            description: 'The first poll option.',
            required: true,
            max_length: 80,
          },
          {
            type: 3,
            name: 'option2',
            description: 'The second poll option.',
            required: true,
            max_length: 80,
          },
          {
            type: 3,
            name: 'duration',
            description: 'How long the poll remains open.',
            required: true,
            choices: pollDurationChoices,
          },
          {
            type: 3,
            name: 'option3',
            description: 'An optional third poll option.',
            required: false,
            max_length: 80,
          },
          {
            type: 3,
            name: 'option4',
            description: 'An optional fourth poll option.',
            required: false,
            max_length: 80,
          },
          {
            type: 3,
            name: 'option5',
            description: 'An optional fifth poll option.',
            required: false,
            max_length: 80,
          },
        ],
      },
      {
        type: 1,
        name: 'poll-close',
        description: 'Close one of your active polls early.',
        options: [
          {
            type: 3,
            name: 'poll_id',
            description: 'The 12-character poll ID.',
            required: true,
            max_length: 12,
          },
        ],
      },
    );
  }

  return definitions;
};
