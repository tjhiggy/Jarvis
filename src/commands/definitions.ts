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

interface ReminderStringOptionDefinition {
  readonly type: 3;
  readonly name: 'in' | 'message' | 'id';
  readonly description: string;
  readonly required: true;
  readonly max_length: number;
}

interface ReminderSubcommandDefinition {
  readonly type: 1;
  readonly name: 'set' | 'list' | 'cancel';
  readonly description: string;
  readonly options?: readonly ReminderStringOptionDefinition[];
}

interface FantasySubcommandDefinition {
  readonly type: 1;
  readonly name: 'standings';
  readonly description: string;
}

interface IntroductionOptionDefinition {
  readonly type: 3;
  readonly name: 'name' | 'interests' | 'aboard' | 'id' | 'draft_id';
  readonly description: string;
  readonly required: boolean;
  readonly max_length: number;
}

interface IntroductionSubcommandDefinition {
  readonly type: 1;
  readonly name: 'preview' | 'confirm' | 'cancel';
  readonly description: string;
  readonly options?: readonly IntroductionOptionDefinition[];
}

interface SuggestionOptionDefinition {
  readonly type: 3;
  readonly name: 'title' | 'description' | 'id' | 'draft_id';
  readonly description: string;
  readonly required: true;
  readonly max_length: number;
}

interface SuggestionSubcommandDefinition {
  readonly type: 1;
  readonly name: 'confirm' | 'cancel' | 'preview' | 'delete';
  readonly description: string;
  readonly options?: readonly SuggestionOptionDefinition[];
}
interface EventOptionDefinition {
  readonly type: 3;
  readonly name:
    'title' | 'description' | 'start' | 'timezone' | 'capacity' | 'end' | 'id';
  readonly description: string;
  readonly required: boolean;
  readonly max_length: number;
}
interface EventSubcommandDefinition {
  readonly type: 1;
  readonly name: 'create' | 'list' | 'details' | 'cancel';
  readonly description: string;
  readonly options?: readonly EventOptionDefinition[];
}
interface RecapSubcommandDefinition {
  readonly type: 1;
  readonly name: 'preview' | 'enable' | 'pause' | 'resume';
  readonly description: string;
}
interface TriviaSubcommandDefinition {
  readonly type: 1;
  readonly name: 'start' | 'opt-out' | 'opt-in';
  readonly description: string;
}
interface EngagementSubcommandDefinition {
  readonly type: 1;
  readonly name: 'status' | 'pause' | 'resume' | 'delete';
  readonly description: string;
  readonly options?: readonly {
    readonly type: 3;
    readonly name: 'user_id';
    readonly description: string;
    readonly required: false;
    readonly max_length: 20;
  }[];
}
interface GameNightSubcommandDefinition {
  readonly type: 1;
  readonly name: 'create' | 'list';
  readonly description: string;
  readonly options?: readonly {
    readonly type: 3;
    readonly name: 'game' | 'start' | 'details' | 'timezone' | 'capacity';
    readonly description: string;
    readonly required: boolean;
    readonly max_length: number;
  }[];
}
interface LfgOptionDefinition { readonly type: 3; readonly name: 'game' | 'when' | 'details'; readonly description: string; readonly required: boolean; readonly max_length: number; }
interface BirthdaySubcommandDefinition { readonly type: 1; readonly name: 'set' | 'show' | 'delete'; readonly description: string; readonly options?: readonly { readonly type: 3; readonly name: 'date' | 'timezone'; readonly description: string; readonly required: boolean; readonly max_length: number; }[]; }

export type CommandOptionDefinition =
  | InputCommandOptionDefinition
  | FaqTopicOptionDefinition
  | RequiredStringOptionDefinition
  | OptionalPollOptionDefinition
  | PollDurationOptionDefinition
  | ReminderSubcommandDefinition
  | FantasySubcommandDefinition
  | IntroductionOptionDefinition
  | IntroductionSubcommandDefinition
  | SuggestionOptionDefinition
  | SuggestionSubcommandDefinition
  | EventOptionDefinition
  | EventSubcommandDefinition
  | GameNightSubcommandDefinition
  | LfgOptionDefinition
  | RecapSubcommandDefinition
  | TriviaSubcommandDefinition
  | EngagementSubcommandDefinition
  | BirthdaySubcommandDefinition;

export interface CommandDefinition {
  readonly type: 1;
  readonly name:
    | 'ask'
    | 'search'
    | 'forget'
    | 'help'
    | 'status'
    | 'faq'
    | 'reminder'
    | 'poll'
    | 'poll-close'
    | 'fantasy'
    | 'introduce'
    | 'introduction'
    | 'suggest'
    | 'suggestion'
    | 'event'
    | 'game-night'
    | 'lfg'
    | 'recap'
    | 'trivia'
    | 'engagement'
    | 'birthday';
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
    {
      type: 1,
      name: 'reminder',
      description: 'Manage your personal reminders.',
      options: [
        {
          type: 1,
          name: 'set',
          description: 'Create a personal reminder.',
          options: [
            {
              type: 3,
              name: 'in',
              description: 'Delay such as 10 minutes, 2 hours, or 3 days.',
              required: true,
              max_length: 64,
            },
            {
              type: 3,
              name: 'message',
              description: 'What to remind you about.',
              required: true,
              max_length: 500,
            },
          ],
        },
        {
          type: 1,
          name: 'list',
          description: 'List your retained reminders.',
        },
        {
          type: 1,
          name: 'cancel',
          description: 'Cancel one of your reminders.',
          options: [
            {
              type: 3,
              name: 'id',
              description: 'The 12-character reminder ID.',
              required: true,
              max_length: 12,
            },
          ],
        },
      ],
    },
    {
      type: 1,
      name: 'fantasy',
      description: 'Read-only Muthaship fantasy football data.',
      options: [
        {
          type: 1,
          name: 'standings',
          description: 'Show current league standings.',
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

  definitions.push(
    {
      type: 1,
      name: 'introduce',
      description: 'Privately preview and post a guided crew introduction.',
      options: [
        {
          type: 1,
          name: 'preview',
          description: 'Create a private preview before posting.',
          options: [
            {
              type: 3,
              name: 'name',
              description:
                'Optional preferred name; defaults to your Discord display name.',
              required: false,
              max_length: 80,
            },
            {
              type: 3,
              name: 'interests',
              description: 'A few interests to share.',
              required: true,
              max_length: 300,
            },
            {
              type: 3,
              name: 'aboard',
              description: 'What brings you aboard.',
              required: true,
              max_length: 500,
            },
          ],
        },
        {
          type: 1,
          name: 'confirm',
          description: 'Post one private preview.',
          options: [
            {
              type: 3,
              name: 'draft_id',
              description: 'Private preview ID.',
              required: true,
              max_length: 128,
            },
          ],
        },
        {
          type: 1,
          name: 'cancel',
          description: 'Discard one private preview.',
          options: [
            {
              type: 3,
              name: 'draft_id',
              description: 'Private preview ID.',
              required: true,
              max_length: 128,
            },
          ],
        },
      ],
    },
    {
      type: 1,
      name: 'introduction',
      description: 'Manage your guided introduction.',
      options: [
        {
          type: 3,
          name: 'id',
          description: 'Introduction ID to delete.',
          required: true,
          max_length: 128,
        },
      ],
    },
    {
      type: 1,
      name: 'suggest',
      description: 'Privately preview and post a crew suggestion.',
      options: [
        {
          type: 1,
          name: 'preview',
          description: 'Create a private preview before posting.',
          options: [
            {
              type: 3,
              name: 'title',
              description: 'Short suggestion title.',
              required: true,
              max_length: 120,
            },
            {
              type: 3,
              name: 'description',
              description: 'Suggestion details.',
              required: true,
              max_length: 1000,
            },
          ],
        },
        {
          type: 1,
          name: 'confirm',
          description: 'Post one private preview.',
          options: [
            {
              type: 3,
              name: 'draft_id',
              description: 'Private preview ID.',
              required: true,
              max_length: 128,
            },
          ],
        },
        {
          type: 1,
          name: 'cancel',
          description: 'Discard one private preview.',
          options: [
            {
              type: 3,
              name: 'draft_id',
              description: 'Private preview ID.',
              required: true,
              max_length: 128,
            },
          ],
        },
      ],
    },
    {
      type: 1,
      name: 'suggestion',
      description: 'Manage your untriaged suggestion.',
      options: [
        {
          type: 1,
          name: 'delete',
          description: 'Archive one untriaged suggestion.',
          options: [
            {
              type: 3,
              name: 'id',
              description: 'Suggestion ID to archive.',
              required: true,
              max_length: 128,
            },
          ],
        },
      ],
    },
    {
      type: 1,
      name: 'event',
      description: 'Create, browse, and manage MuthaShip events.',
      options: [
        {
          type: 1,
          name: 'create',
          description: 'Create an event as an administrator.',
          options: [
            {
              type: 3,
              name: 'title',
              description: 'Event title.',
              required: true,
              max_length: 200,
            },
            {
              type: 3,
              name: 'description',
              description: 'Event details.',
              required: true,
              max_length: 2000,
            },
            {
              type: 3,
              name: 'start',
              description: 'Local start: YYYY-MM-DD HH:mm.',
              required: true,
              max_length: 16,
            },
            {
              type: 3,
              name: 'timezone',
              description: 'Optional IANA timezone; defaults to America/New_York.',
              required: false,
              max_length: 100,
            },
            {
              type: 3,
              name: 'capacity',
              description: 'Optional confirmed seat count; defaults to 20.',
              required: false,
              max_length: 4,
            },
            {
              type: 3,
              name: 'end',
              description: 'Optional local end: YYYY-MM-DD HH:mm.',
              required: false,
              max_length: 16,
            },
          ],
        },
        { type: 1, name: 'list', description: 'List upcoming events.' },
        {
          type: 1,
          name: 'details',
          description: 'Show event RSVP totals.',
          options: [
            {
              type: 3,
              name: 'id',
              description: 'Event ID.',
              required: true,
              max_length: 128,
            },
          ],
        },
        {
          type: 1,
          name: 'cancel',
          description: 'Cancel an event as an administrator.',
          options: [
            {
              type: 3,
              name: 'id',
              description: 'Event ID.',
              required: true,
              max_length: 128,
            },
          ],
        },
      ],
    },
    {
      type: 1,
      name: 'game-night',
      description: 'Schedule a crew game night with RSVP buttons.',
      options: [
        { type: 1, name: 'create', description: 'Schedule a game night as an administrator.', options: [
          { type: 3, name: 'game', description: 'Game or activity name.', required: true, max_length: 120 },
          { type: 3, name: 'start', description: 'Local start: YYYY-MM-DD HH:mm.', required: true, max_length: 16 },
          { type: 3, name: 'details', description: 'Optional details for the crew.', required: false, max_length: 1000 },
          { type: 3, name: 'timezone', description: 'Optional IANA timezone.', required: false, max_length: 100 },
          { type: 3, name: 'capacity', description: 'Optional seat count; defaults to 20.', required: false, max_length: 4 },
        ] },
        { type: 1, name: 'list', description: 'List upcoming game nights.' },
      ],
    },
    {
      type: 1,
      name: 'lfg',
      description: 'Signal the crew that you are looking for a group.',
      options: [
        { type: 3, name: 'game', description: 'Game or activity.', required: true, max_length: 120 },
        { type: 3, name: 'when', description: 'Optional time or availability.', required: false, max_length: 120 },
        { type: 3, name: 'details', description: 'Optional platform, mode, or seat details.', required: false, max_length: 500 },
      ],
    },
    {
      type: 1,
      name: 'recap',
      description: 'Preview or control weekly community recaps.',
      options: [
        {
          type: 1,
          name: 'preview',
          description: 'Privately preview the current weekly recap.',
        },
        {
          type: 1,
          name: 'enable',
          description: 'Opt this MuthaShip into weekly recaps.',
        },
        {
          type: 1,
          name: 'pause',
          description: 'Pause scheduled weekly recaps.',
        },
        {
          type: 1,
          name: 'resume',
          description: 'Resume scheduled weekly recaps.',
        },
      ],
    },
    {
      type: 1,
      name: 'trivia',
      description: 'Start one short optional trivia round.',
      options: [
        {
          type: 1,
          name: 'start',
          description: 'Open a one-minute curated trivia round.',
        },
        {
          type: 1,
          name: 'opt-out',
          description:
            'Stop future trivia participation and remove your retained activity data.',
        },
        {
          type: 1,
          name: 'opt-in',
          description: 'Allow future trivia participation on this MuthaShip.',
        },
      ],
    },
    {
      type: 1,
      name: 'engagement',
      description: 'View or control engagement scheduling as an administrator.',
      options: [
        { type: 1, name: 'status', description: 'Show safe engagement health.' },
        { type: 1, name: 'pause', description: 'Pause engagement scheduling.' },
        { type: 1, name: 'resume', description: 'Resume engagement scheduling.' },
        {
          type: 1,
          name: 'delete',
          description: 'Delete retained engagement records.',
          options: [
            { type: 3, name: 'user_id', description: 'Optional member ID for administrators.', required: false, max_length: 20 },
          ],
        },
      ],
    },
    { type: 1, name: 'birthday', description: 'Opt in to a private MuthaShip birthday announcement.', options: [
      { type: 1, name: 'set', description: 'Save your birthday as MM-DD (no year).', options: [{ type: 3, name: 'date', description: 'Month and day, for example 07-04.', required: true, max_length: 5 }, { type: 3, name: 'timezone', description: 'IANA timezone, for example America/New_York.', required: false, max_length: 64 }] },
      { type: 1, name: 'show', description: 'Show your saved birthday privately.' },
      { type: 1, name: 'delete', description: 'Delete your saved birthday.' },
    ] },
  );

  return definitions;
};
