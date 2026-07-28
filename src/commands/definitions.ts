export interface CommandOptionDefinition {
  readonly type: 3;
  readonly name: 'prompt' | 'query';
  readonly description: string;
  readonly required: true;
  readonly max_length: number;
}

export interface CommandDefinition {
  readonly type: 1;
  readonly name: 'ask' | 'search' | 'forget' | 'help' | 'status';
  readonly description: string;
  readonly options?: readonly CommandOptionDefinition[];
}

const discordStringOptionMaxLength = 6_000;

export const createCommandDefinitions = (
  maxInputChars: number,
): readonly CommandDefinition[] => {
  if (!Number.isSafeInteger(maxInputChars) || maxInputChars < 1) {
    throw new RangeError(
      'Command prompt maximum must be a positive safe integer.',
    );
  }

  return [
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
  ];
};
