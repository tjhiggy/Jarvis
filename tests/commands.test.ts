import { describe, expect, it, vi } from 'vitest';
import { createCommandDefinitions } from '../src/commands/definitions.js';
import type { FaqCatalog, FaqEntry } from '../src/faq/faq-catalog.js';
import type { PollController } from '../src/polls/poll-controller.js';
import {
  pollDurationChoices,
  pollDurationMilliseconds,
} from '../src/polls/poll-duration.js';
import {
  handleCommand,
  type CommandDependencies,
  type CommandInteraction,
  type ReplyPayload,
} from '../src/commands/handlers.js';
import { isAllowedChannel } from '../src/discord/access.js';
import { ReminderServiceError } from '../src/reminders/reminder-service.js';
import type { ReminderView } from '../src/reminders/reminder-types.js';

const safeMentions = { parse: [], repliedUser: false };

describe('command definitions', () => {
  it('always registers the exact personal reminder subcommands', () => {
    const definitions = createCommandDefinitions(123, [
      faqEntry('capabilities', 'Jarvis capabilities'),
      faqEntry('runtime', 'Jarvis runtime'),
    ]);

    expect(definitions.map((definition) => definition.name)).toEqual([
      'ask',
      'search',
      'forget',
      'help',
      'status',
      'faq',
      'knowledge',
      'catch-me-up',
      'channel-summary',
      'reminder',
      'fantasy',
      'introduce',
      'introduction',
      'suggest',
      'post',
      'github',
      'suggestion',
      'event',
      'game-night',
      'lfg',
      'recap',
      'trivia',
      'engagement',
      'birthday',
      'roles',
    ]);
    expect(definitions[0]).toMatchObject({
      name: 'ask',
      options: [
        {
          name: 'prompt',
          required: true,
          max_length: 123,
        },
      ],
    });
    expect(definitions[1]).toMatchObject({
      name: 'search',
      options: [{ name: 'query', required: true, max_length: 123 }],
    });
    expect(definitions[5]).toEqual({
      type: 1,
      name: 'faq',
      description: 'Browse approved Jarvis information.',
      options: [
        {
          type: 3,
          name: 'topic',
          description: 'Choose an approved Jarvis topic.',
          required: false,
          choices: [
            { name: 'Jarvis capabilities', value: 'capabilities' },
            { name: 'Jarvis runtime', value: 'runtime' },
          ],
        },
      ],
    });
    expect(definitions[9]).toEqual({
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
        {
          type: 1,
          name: 'shared-set',
          description: 'Create an administrator shared reminder.',
          options: [
            { type: 3, name: 'in', description: 'Delay such as 10 minutes or 2 hours.', required: true, max_length: 64 },
            { type: 3, name: 'message', description: 'Message to post.', required: true, max_length: 500 },
          ],
        },
        { type: 1, name: 'shared-list', description: 'List shared reminders in this server.' },
        { type: 1, name: 'shared-cancel', description: 'Cancel a shared reminder.', options: [{ type: 3, name: 'id', description: 'The reminder ID.', required: true, max_length: 12 }] },
      ],
    });
  });

  it('adds exact poll command contracts when poll registration is enabled', () => {
    const definitions = createCommandDefinitions(
      123,
      [faqEntry('capabilities', 'Jarvis capabilities')],
      true,
    );

    expect(definitions.map((definition) => definition.name)).toEqual([
      'ask',
      'search',
      'forget',
      'help',
      'status',
      'faq',
      'knowledge',
      'catch-me-up',
      'channel-summary',
      'reminder',
      'fantasy',
      'poll',
      'poll-close',
      'introduce',
      'introduction',
      'suggest',
      'post',
      'github',
      'suggestion',
      'event',
      'game-night',
      'lfg',
      'recap',
      'trivia',
      'engagement',
      'birthday',
      'roles',
    ]);
    expect(definitions[11]).toMatchObject({
      name: 'poll',
      options: [
        { name: 'question', required: true, max_length: 200 },
        { name: 'option1', required: true, max_length: 80 },
        { name: 'option2', required: true, max_length: 80 },
        {
          name: 'duration',
          required: true,
          choices: [
            { name: '15 minutes', value: '15m' },
            { name: '1 hour', value: '1h' },
            { name: '6 hours', value: '6h' },
            { name: '24 hours', value: '24h' },
            { name: '3 days', value: '3d' },
            { name: '7 days', value: '7d' },
          ],
        },
        { name: 'option3', required: false, max_length: 80 },
        { name: 'option4', required: false, max_length: 80 },
        { name: 'option5', required: false, max_length: 80 },
      ],
    });
    expect(definitions[12]).toMatchObject({
      name: 'poll-close',
      options: [{ name: 'poll_id', required: true, max_length: 12 }],
    });
  });

  it('places every required option before optional options', () => {
    const definitions = createCommandDefinitions(
      123,
      [faqEntry('capabilities', 'Jarvis capabilities')],
      true,
    );

    for (const definition of definitions) {
      const options = (definition.options ?? []).filter(
        (option) => option.type === 3,
      );
      const firstOptionalOption = options.findIndex(
        (option) => !option.required,
      );

      if (firstOptionalOption === -1) {
        continue;
      }

      expect(
        options.slice(firstOptionalOption).find((option) => option.required),
        `${definition.name} has a required option after an optional option`,
      ).toBeUndefined();
    }
  });

  it.each([
    ['15m', 900_000],
    ['1h', 3_600_000],
    ['6h', 21_600_000],
    ['24h', 86_400_000],
    ['3d', 259_200_000],
    ['7d', 604_800_000],
  ] as const)('maps the %s poll duration exactly', (value, milliseconds) => {
    expect(pollDurationChoices.map((choice) => choice.value)).toEqual([
      '15m',
      '1h',
      '6h',
      '24h',
      '3d',
      '7d',
    ]);
    expect(pollDurationMilliseconds(value)).toBe(milliseconds);
  });

  it('caps the slash-command prompt at Discord string-option limits', () => {
    const definitions = createCommandDefinitions(12_000, [
      faqEntry('capabilities', 'Jarvis capabilities'),
    ]);

    expect(
      (definitions[0]?.options?.[0] as { max_length?: number }).max_length,
    ).toBe(6_000);
  });

  it('accepts Discord’s 25-choice FAQ boundary', () => {
    const definitions = createCommandDefinitions(
      123,
      Array.from({ length: 25 }, (_, index) =>
        faqEntry(`topic-${index + 1}`, `Topic ${index + 1}`),
      ),
    );

    expect(definitions[5]?.options?.[0]).toMatchObject({
      name: 'topic',
      choices: expect.arrayContaining([
        { name: 'Topic 1', value: 'topic-1' },
        { name: 'Topic 25', value: 'topic-25' },
      ]),
    });
    expect(
      (definitions[5]?.options?.[0] as { choices?: readonly unknown[] })
        .choices,
    ).toHaveLength(25);
  });

  it.each([
    [[]],
    [
      Array.from({ length: 26 }, (_, index) =>
        faqEntry(`topic-${index + 1}`, `Topic ${index + 1}`),
      ),
    ],
  ])(
    'rejects FAQ command definitions outside Discord choice limits',
    (faqEntries) => {
      expect(() => createCommandDefinitions(123, faqEntries)).toThrow(
        'FAQ command choices must contain between 1 and 25 entries.',
      );
    },
  );
});

function faqEntry(id: string, label: string): FaqEntry {
  return {
    id,
    label,
    question: `What is ${label}?`,
    answer: `${label} answer.`,
  };
}

describe('isAllowedChannel', () => {
  it('accepts a thread whose parent is allowlisted', () => {
    expect(
      isAllowedChannel('thread-7', 'channel-1', new Set(['channel-1'])),
    ).toBe(true);
  });
});

describe('handleCommand', () => {
  it.each(['set', 'list', 'cancel'] as const)(
    'rejects /reminder %s in DMs and disallowed channels ephemerally',
    async (subcommand) => {
      const dm = interaction({
        commandName: 'reminder',
        subcommand,
        guildId: null,
      });
      const disallowed = interaction({
        commandName: 'reminder',
        subcommand,
        channelId: 'off-limits',
      });
      const commandDependencies = dependencies({
        allowedChannelIds: new Set(['allowed']),
      });

      await handleCommand(dm.interaction, commandDependencies);
      await handleCommand(disallowed.interaction, commandDependencies);

      for (const fake of [dm, disallowed]) {
        expect(fake.deferred).toEqual([]);
        expect(fake.replies).toEqual([
          expect.objectContaining({ ephemeral: true }),
        ]);
      }
    },
  );

  it('defers /reminder set privately and passes the exact scoped request without using AI', async () => {
    const fake = interaction({
      commandName: 'reminder',
      subcommand: 'set',
      channelId: 'thread-1',
      parentId: 'allowed-parent',
      isThread: true,
      values: {
        in: '2 hours',
        message: ' Check the oven ',
      },
    });
    const setRequests: unknown[] = [];
    let aiRequests = 0;
    const created = reminder({
      channelId: 'thread-1',
      parentChannelId: 'allowed-parent',
      message: 'Check the oven',
    });

    await handleCommand(
      fake.interaction,
      dependencies({
        allowedChannelIds: new Set(['allowed-parent']),
        ask: async () => {
          aiRequests += 1;
          return { status: 'success', text: 'Wrong subsystem.' };
        },
        reminderService: {
          ...inertReminderService(),
          set: async (request) => {
            setRequests.push(request);
            return created;
          },
        },
      }),
    );

    expect(fake.deferred).toEqual([{ ephemeral: true }]);
    expect(setRequests).toEqual([
      {
        guildId: 'guild-1',
        channelId: 'thread-1',
        parentChannelId: 'allowed-parent',
        ownerUserId: 'user-1',
        duration: '2 hours',
        message: ' Check the oven ',
      },
    ]);
    expect(aiRequests).toBe(0);
    expect(fake.edits).toEqual([
      expect.objectContaining({
        content: expect.stringMatching(
          /abcdef234567[\s\S]*<t:1785337200:F>[\s\S]*<#thread-1>[\s\S]*retaining access/i,
        ),
        allowedMentions: safeMentions,
      }),
    ]);
  });

  it('defers /reminder list and cancel privately with guild-and-owner scoping', async () => {
    const list = interaction({
      commandName: 'reminder',
      subcommand: 'list',
    });
    const cancel = interaction({
      commandName: 'reminder',
      subcommand: 'cancel',
      values: { id: 'abcdef234567' },
    });
    const listRequests: unknown[] = [];
    const cancelRequests: unknown[] = [];
    const commandDependencies = dependencies({
      reminderService: {
        set: inertReminderService().set,
        list: async (request) => {
          listRequests.push(request);
          return [reminder()];
        },
        cancel: async (request) => {
          cancelRequests.push(request);
          return reminder({ status: 'cancelled' });
        },
      },
    });

    await handleCommand(list.interaction, commandDependencies);
    await handleCommand(cancel.interaction, commandDependencies);

    expect(list.deferred).toEqual([{ ephemeral: true }]);
    expect(cancel.deferred).toEqual([{ ephemeral: true }]);
    expect(listRequests).toEqual([
      { guildId: 'guild-1', ownerUserId: 'user-1' },
    ]);
    expect(cancelRequests).toEqual([
      {
        guildId: 'guild-1',
        ownerUserId: 'user-1',
        reminderId: 'abcdef234567',
      },
    ]);
    expect(list.edits[0]?.content).toMatch(
      /abcdef234567[\s\S]*<t:1785337200:F>[\s\S]*<#channel-1>[\s\S]*pending[\s\S]*Check the oven/i,
    );
    expect(cancel.edits[0]?.content).toMatch(/abcdef234567[\s\S]*cancelled/i);
  });

  it('rejects malformed reminder IDs privately before cancellation', async () => {
    const fake = interaction({
      commandName: 'reminder',
      subcommand: 'cancel',
      values: { id: 'not-an-id' },
    });
    let cancellations = 0;

    await handleCommand(
      fake.interaction,
      dependencies({
        reminderService: {
          ...inertReminderService(),
          cancel: async () => {
            cancellations += 1;
            return undefined;
          },
        },
      }),
    );

    expect(fake.deferred).toEqual([{ ephemeral: true }]);
    expect(cancellations).toBe(0);
    expect(fake.edits[0]?.content).toMatch(/valid 12-character reminder id/i);
  });

  it.each([
    ['invalid-request', /valid duration and message/i],
    ['active-limit', /10 active reminders/i],
    ['rate-limit', /too many reminder requests/i],
  ] as const)(
    'maps the %s reminder service error to private safe copy',
    async (code, expected) => {
      const fake = interaction({
        commandName: 'reminder',
        subcommand: 'set',
        values: { in: '2 hours', message: 'Check the oven' },
      });

      await handleCommand(
        fake.interaction,
        dependencies({
          reminderService: {
            ...inertReminderService(),
            set: async () => {
              throw new ReminderServiceError(code, 12_345);
            },
          },
        }),
      );

      expect(fake.deferred).toEqual([{ ephemeral: true }]);
      expect(fake.edits[0]?.content).toMatch(expected);
      expect(JSON.stringify(fake.edits)).not.toContain('12_345');
    },
  );

  it('maps owner mismatch, unknown IDs, and storage failures to safe private copy', async () => {
    const missing = interaction({
      commandName: 'reminder',
      subcommand: 'cancel',
      values: { id: 'abcdef234567' },
    });
    const failed = interaction({
      commandName: 'reminder',
      subcommand: 'list',
    });
    const internalDetail = 'C:\\secret\\reminders.db token=oops';

    await handleCommand(
      missing.interaction,
      dependencies({
        reminderService: {
          ...inertReminderService(),
          cancel: async () => undefined,
        },
      }),
    );
    await handleCommand(
      failed.interaction,
      dependencies({
        reminderService: {
          ...inertReminderService(),
          list: async () => {
            throw new Error(internalDetail);
          },
        },
      }),
    );

    expect(missing.edits[0]?.content).toMatch(/not found|do not own/i);
    expect(failed.edits[0]?.content).toMatch(/try again later/i);
    expect(JSON.stringify([...missing.edits, ...failed.edits])).not.toContain(
      internalDetail,
    );
  });

  it('safely chunks retained reminders and filters any cross-owner result', async () => {
    const fake = interaction({
      commandName: 'reminder',
      subcommand: 'list',
    });
    const owned = Array.from({ length: 30 }, (_, index) =>
      reminder({
        id: `abcde${String(index).padStart(7, '2')}`.replace(/0/g, '2'),
        message: `Item ${index + 1}: ${'x'.repeat(500)}`,
      }),
    );
    const leakedText = 'TOP SECRET OTHER USER';

    await handleCommand(
      fake.interaction,
      dependencies({
        reminderService: {
          ...inertReminderService(),
          list: async () => [
            ...owned,
            reminder({ ownerUserId: 'user-2', message: leakedText }),
          ],
        },
      }),
    );

    const payloads = [...fake.edits, ...fake.followUps];
    expect(fake.deferred).toEqual([{ ephemeral: true }]);
    expect(payloads.length).toBeGreaterThan(1);
    expect(payloads.map((payload) => payload.content).join('')).not.toContain(
      leakedText,
    );
    expect(payloads.map((payload) => payload.content).join('')).not.toContain(
      'x'.repeat(100),
    );
    for (const payload of payloads) {
      expect(payload.content?.length).toBeLessThanOrEqual(2_000);
      expect(payload.allowedMentions).toEqual(safeMentions);
    }
    for (const payload of fake.followUps) {
      expect(payload.ephemeral).toBe(true);
    }
  });

  it('rejects /poll when polls are disabled without deferring', async () => {
    const fake = interaction({ commandName: 'poll' });

    await handleCommand(fake.interaction, dependencies());

    expect(fake.deferred).toEqual([]);
    expect(fake.replies).toEqual([
      expect.objectContaining({
        content: expect.stringMatching(/not configured/i),
        ephemeral: true,
      }),
    ]);
  });

  it('routes an authorized /poll in an allowlisted parent thread to the controller', async () => {
    const fake = interaction({
      commandName: 'poll',
      userId: 'admin-1',
      channelId: 'thread-1',
      parentId: 'polls',
      isThread: true,
      values: {
        question: 'Which launch window?',
        option1: 'Now',
        option2: 'Later',
        option3: 'Never',
        duration: '1h',
      },
    });
    const created: unknown[] = [];
    const controller = {
      create: async (request: unknown) => {
        created.push(request);
      },
    } as PollController;

    await handleCommand(
      fake.interaction,
      dependencies({
        allowedChannelIds: new Set(['polls']),
        pollEnabled: true,
        pollAdminUserIds: new Set(['admin-1']),
        pollController: controller,
      }),
    );

    expect(fake.deferred).toEqual([{ ephemeral: false }]);
    expect(created).toEqual([
      expect.objectContaining({
        guildId: 'guild-1',
        channelId: 'thread-1',
        conversationId: 'thread-1',
        parentChannelId: 'polls',
        creatorUserId: 'admin-1',
        options: ['Now', 'Later', 'Never'],
        duration: '1h',
      }),
    ]);
  });

  it('keeps /poll-close administrator-only and forwards its exact poll ID', async () => {
    const unauthorized = interaction({
      commandName: 'poll-close',
      values: { poll_id: 'abcdef234567' },
    });
    const closed: unknown[] = [];
    const controller = {
      close: async (request: unknown) => {
        closed.push(request);
      },
    } as PollController;
    const commandDependencies = dependencies({
      pollEnabled: true,
      pollAdminUserIds: new Set(['admin-1']),
      pollController: controller,
    });

    await handleCommand(unauthorized.interaction, commandDependencies);
    const authorized = interaction({
      commandName: 'poll-close',
      userId: 'admin-1',
      values: { poll_id: 'abcdef234567' },
    });
    await handleCommand(authorized.interaction, commandDependencies);

    expect(unauthorized.replies).toEqual([
      expect.objectContaining({
        content: expect.stringMatching(/administrators/i),
        ephemeral: true,
      }),
    ]);
    expect(authorized.deferred).toEqual([{ ephemeral: true }]);
    expect(closed).toEqual([
      expect.objectContaining({ pollId: 'abcdef234567' }),
    ]);
  });

  it('rejects an /ask request from a DM without invoking the conversation service', async () => {
    const fake = interaction({
      commandName: 'ask',
      guildId: null,
      prompt: 'hello',
    });
    let requests = 0;

    await handleCommand(
      fake.interaction,
      dependencies({
        ask: async () => {
          requests += 1;
          return { status: 'success', text: 'Nope.' };
        },
      }),
    );

    expect(requests).toBe(0);
    expect(fake.deferred).toEqual([]);
    expect(fake.replies).toEqual([
      expect.objectContaining({
        content: expect.stringMatching(/server/i),
        ephemeral: true,
        allowedMentions: safeMentions,
      }),
    ]);
  });

  it('defers /ask and safely edits its response', async () => {
    const fake = interaction({
      commandName: 'ask',
      prompt: 'Where is the reactor manual?',
    });
    const requests: unknown[] = [];

    await handleCommand(
      fake.interaction,
      dependencies({
        ask: async (request) => {
          requests.push(request);
          return { status: 'success', text: '@everyone the manual is secure.' };
        },
      }),
    );

    expect(fake.deferred).toHaveLength(1);
    expect(fake.edits).toEqual([
      expect.objectContaining({
        content: '@\u200beveryone the manual is secure.',
        allowedMentions: safeMentions,
      }),
    ]);
    expect(requests).toEqual([
      expect.objectContaining({
        guildId: 'guild-1',
        conversationId: 'channel-1',
        channelId: 'channel-1',
        userId: 'user-1',
        prompt: 'Where is the reactor manual?',
      }),
    ]);
  });

  it('leaves slash-command member IDs for the conversation service normalization boundary', async () => {
    const fake = interaction({
      commandName: 'ask',
      prompt: 'Who is <@1004887251303534592>?',
    });
    const prompts: string[] = [];

    await handleCommand(
      fake.interaction,
      dependencies({
        ask: async (request) => {
          prompts.push(request.prompt);
          return { status: 'success', text: 'No verified member details.' };
        },
      }),
    );

    expect(prompts).toEqual(['Who is <@1004887251303534592>?']);
  });

  it('forces current web grounding for /search', async () => {
    const fake = interaction({
      commandName: 'search',
      prompt: 'ARC Raiders update',
    });
    const requests: unknown[] = [];

    await handleCommand(
      fake.interaction,
      dependencies({
        ask: async (request) => {
          requests.push(request);
          return { status: 'success', text: 'Grounded answer.' };
        },
      }),
    );

    expect(requests).toEqual([
      expect.objectContaining({
        prompt: 'ARC Raiders update',
        webSearch: true,
      }),
    ]);
    expect(fake.edits).toEqual([
      expect.objectContaining({ content: 'Grounded answer.' }),
    ]);
  });

  it('rejects /search safely when no web-search key is configured', async () => {
    const fake = interaction({ commandName: 'search' });
    let requests = 0;

    await handleCommand(
      fake.interaction,
      dependencies({
        tavilyApiKey: '',
        ask: async () => {
          requests += 1;
          return { status: 'success', text: 'This must not run.' };
        },
      }),
    );

    expect(requests).toBe(0);
    expect(fake.replies).toEqual([
      expect.objectContaining({
        content: expect.stringMatching(/web search.*not configured/i),
        ephemeral: true,
      }),
    ]);
  });

  it('inherits allowlist access only for actual threads, not category children', async () => {
    const categoryChild = interaction({
      commandName: 'ask',
      channelId: 'category-child',
      parentId: 'allowed-parent',
      isThread: false,
    });
    const thread = interaction({
      commandName: 'ask',
      channelId: 'thread-1',
      parentId: 'allowed-parent',
      isThread: true,
    });
    const requests: unknown[] = [];
    const commandDependencies = dependencies({
      allowedChannelIds: new Set(['allowed-parent']),
      ask: async (request) => {
        requests.push(request);
        return { status: 'success', text: 'Allowed.' };
      },
    });

    await handleCommand(categoryChild.interaction, commandDependencies);
    await handleCommand(thread.interaction, commandDependencies);

    expect(categoryChild.deferred).toEqual([]);
    expect(categoryChild.replies).toEqual([
      expect.objectContaining({
        content: expect.stringMatching(/not available/i),
      }),
    ]);
    expect(requests).toEqual([
      expect.objectContaining({
        channelId: 'thread-1',
        parentChannelId: 'allowed-parent',
      }),
    ]);
  });

  it('safely edits a deferred /ask when the conversation service fails', async () => {
    const fake = interaction({ commandName: 'ask' });
    const internalDetail = 'token=discord-secret';

    await handleCommand(
      fake.interaction,
      dependencies({
        ask: async () => {
          throw new Error(internalDetail);
        },
      }),
    );

    expect(fake.edits).toEqual([
      expect.objectContaining({
        content: expect.stringMatching(/could not be completed/i),
        allowedMentions: safeMentions,
      }),
    ]);
    expect(fake.edits[0]?.content).not.toContain(internalDetail);
  });

  it('rejects an oversized /ask prompt before it reaches the conversation service', async () => {
    const fake = interaction({ commandName: 'ask', prompt: 'x'.repeat(6) });
    let requests = 0;

    await handleCommand(
      fake.interaction,
      dependencies({
        maxInputChars: 5,
        ask: async () => {
          requests += 1;
          return { status: 'success', text: 'Nope.' };
        },
      }),
    );

    expect(requests).toBe(0);
    expect(fake.replies).toEqual([
      expect.objectContaining({
        content: expect.stringMatching(/valid request/i),
        ephemeral: true,
        allowedMentions: safeMentions,
      }),
    ]);
  });

  it('forgets only the current guild conversation and reports its deleted count safely', async () => {
    const fake = interaction({ commandName: 'forget', channelId: 'thread-1' });
    const messages = new Map<string, number>([
      ['guild-1:thread-1', 2],
      ['guild-1:channel-2', 3],
      ['guild-2:thread-1', 5],
    ]);

    await handleCommand(
      fake.interaction,
      dependencies({
        clear: async ({ guildId, conversationId }) => {
          const key = `${guildId}:${conversationId}`;
          const deleted = messages.get(key) ?? 0;
          messages.delete(key);
          return deleted;
        },
      }),
    );

    expect(messages).toEqual(
      new Map<string, number>([
        ['guild-1:channel-2', 3],
        ['guild-2:thread-1', 5],
      ]),
    );
    expect(fake.deferred).toHaveLength(1);
    expect(fake.edits).toEqual([
      expect.objectContaining({
        content: expect.stringMatching(/2/),
        allowedMentions: safeMentions,
      }),
    ]);
  });

  it('safely edits a deferred /forget when storage fails', async () => {
    const fake = interaction({ commandName: 'forget' });
    const internalDetail = 'database=C:\\private';

    await handleCommand(
      fake.interaction,
      dependencies({
        clear: async () => {
          throw new Error(internalDetail);
        },
      }),
    );

    expect(fake.edits).toEqual([
      expect.objectContaining({
        content: expect.stringMatching(/could not be completed/i),
        allowedMentions: safeMentions,
      }),
    ]);
    expect(fake.edits[0]?.content).not.toContain(internalDetail);
  });

  it('returns only the approved public answer for an exact /faq topic without side effects', async () => {
    const fake = interaction({ commandName: 'faq', topic: 'capabilities' });

    await handleCommand(
      fake.interaction,
      faqDependencies(
        faqCatalog([
          {
            id: 'capabilities',
            label: 'Jarvis capabilities',
            question: 'What can Jarvis do?',
            answer: 'Jarvis is an advisory AI, not a command deck.',
          },
        ]),
      ),
    );

    expect(fake.deferred).toEqual([]);
    expect(fake.replies).toEqual([
      {
        content: 'Jarvis is an advisory AI, not a command deck.',
        ephemeral: false,
        allowedMentions: safeMentions,
      },
    ]);
  });

  it('lists approved FAQ questions publicly when /faq omits a topic without side effects', async () => {
    const fake = interaction({ commandName: 'faq', topic: null });

    await handleCommand(
      fake.interaction,
      faqDependencies(
        faqCatalog([
          {
            id: 'capabilities',
            label: 'Jarvis capabilities',
            question: 'What can Jarvis do?',
            answer: 'Jarvis is an advisory AI, not a command deck.',
          },
          {
            id: 'runtime',
            label: 'Jarvis runtime',
            question: 'Where does Jarvis run?',
            answer: 'Jarvis runs locally.',
          },
        ]),
      ),
    );

    expect(fake.deferred).toEqual([]);
    expect(fake.replies).toEqual([
      {
        content:
          'Choose an approved FAQ topic:\n- What can Jarvis do?\n- Where does Jarvis run?',
        ephemeral: false,
        allowedMentions: safeMentions,
      },
    ]);
  });

  it('guides unknown /faq topics to the approved public questions without side effects', async () => {
    const fake = interaction({ commandName: 'faq', topic: 'self-destruct' });

    await handleCommand(
      fake.interaction,
      faqDependencies(
        faqCatalog([
          {
            id: 'capabilities',
            label: 'Jarvis capabilities',
            question: 'What can Jarvis do?',
            answer: 'Jarvis is an advisory AI, not a command deck.',
          },
          {
            id: 'runtime',
            label: 'Jarvis runtime',
            question: 'Where does Jarvis run?',
            answer: 'Jarvis runs locally.',
          },
        ]),
      ),
    );

    expect(fake.deferred).toEqual([]);
    expect(fake.replies).toEqual([
      {
        content:
          'That FAQ topic is not available. Choose an approved FAQ topic:\n- Jarvis capabilities\n- Jarvis runtime',
        ephemeral: false,
        allowedMentions: safeMentions,
      },
    ]);
  });

  it('rejects /faq from a DM without side effects', async () => {
    const fake = interaction({
      commandName: 'faq',
      guildId: null,
      topic: 'capabilities',
    });

    await handleCommand(
      fake.interaction,
      faqDependencies(
        faqCatalog([
          {
            id: 'capabilities',
            label: 'Jarvis capabilities',
            question: 'What can Jarvis do?',
            answer: 'Jarvis is an advisory AI, not a command deck.',
          },
        ]),
      ),
    );

    expect(fake.deferred).toEqual([]);
    expect(fake.replies).toEqual([
      expect.objectContaining({
        content: expect.stringMatching(/server/i),
        ephemeral: true,
        allowedMentions: safeMentions,
      }),
    ]);
  });

  it('rejects /faq outside the direct channel allowlist without side effects', async () => {
    const fake = interaction({ commandName: 'faq', topic: 'capabilities' });

    await handleCommand(
      fake.interaction,
      faqDependencies(
        faqCatalog([
          {
            id: 'capabilities',
            label: 'Jarvis capabilities',
            question: 'What can Jarvis do?',
            answer: 'Jarvis is an advisory AI, not a command deck.',
          },
        ]),
        { allowedChannelIds: new Set(['another-channel']) },
      ),
    );

    expect(fake.deferred).toEqual([]);
    expect(fake.replies).toEqual([
      expect.objectContaining({
        content: expect.stringMatching(/not available/i),
        ephemeral: true,
        allowedMentions: safeMentions,
      }),
    ]);
  });

  it('accepts /faq in a thread whose parent is allowlisted without side effects', async () => {
    const fake = interaction({
      commandName: 'faq',
      channelId: 'thread-1',
      parentId: 'allowed-parent',
      isThread: true,
      topic: 'runtime',
    });

    await handleCommand(
      fake.interaction,
      faqDependencies(
        faqCatalog([
          {
            id: 'runtime',
            label: 'Jarvis runtime',
            question: 'Where does Jarvis run?',
            answer: 'Jarvis runs locally.',
          },
        ]),
        { allowedChannelIds: new Set(['allowed-parent']) },
      ),
    );

    expect(fake.deferred).toEqual([]);
    expect(fake.replies).toEqual([
      {
        content: 'Jarvis runs locally.',
        ephemeral: false,
        allowedMentions: safeMentions,
      },
    ]);
  });

  it('neutralizes mass mentions in approved /faq answers without side effects', async () => {
    const fake = interaction({ commandName: 'faq', topic: 'mentions' });

    await handleCommand(
      fake.interaction,
      faqDependencies(
        faqCatalog([
          {
            id: 'mentions',
            label: 'Mention safety',
            question: 'How are mentions handled?',
            answer: '@everyone, remain calm.',
          },
        ]),
      ),
    );

    expect(fake.deferred).toEqual([]);
    expect(fake.replies).toEqual([
      {
        content: '@\u200beveryone, remain calm.',
        ephemeral: false,
        allowedMentions: safeMentions,
      },
    ]);
  });

  it('chunks the maximum valid /faq question listing into safe public replies', async () => {
    const fake = interaction({ commandName: 'faq', topic: null });
    const entries = maximumFaqEntries();
    const expectedContent = `Choose an approved FAQ topic:\n${entries
      .map((entry) => `- ${entry.question}`)
      .join('\n')}`;

    await handleCommand(fake.interaction, faqDependencies(faqCatalog(entries)));

    expectSafePublicChunks(fake, expectedContent);
  });

  it('chunks maximum valid /faq label guidance into safe public replies', async () => {
    const fake = interaction({ commandName: 'faq', topic: 'not-a-topic' });
    const entries = maximumFaqEntries();
    const expectedContent =
      'That FAQ topic is not available. Choose an approved FAQ topic:\n' +
      entries.map((entry) => `- ${entry.label}`).join('\n');

    await handleCommand(fake.interaction, faqDependencies(faqCatalog(entries)));

    expectSafePublicChunks(fake, expectedContent);
  });

  it('chunks an 1800-character /faq answer after mention neutralization expands it', async () => {
    const fake = interaction({ commandName: 'faq', topic: 'mentions' });
    const answer = '<@123>'.repeat(300);
    const expectedContent = '<@\u200b123>'.repeat(300);

    expect(answer).toHaveLength(1_800);
    expect(expectedContent.length).toBeGreaterThan(2_000);

    await handleCommand(
      fake.interaction,
      faqDependencies(
        faqCatalog([
          {
            id: 'mentions',
            label: 'Mention safety',
            question: 'How are mentions handled?',
            answer,
          },
        ]),
      ),
    );

    expectSafePublicChunks(fake, expectedContent);
  });

  it('lists every supported command and no imaginary server controls in /help', async () => {
    const fake = interaction({ commandName: 'help' });

    await handleCommand(fake.interaction, dependencies());

    expect(fake.replies).toEqual([
      expect.objectContaining({
        content: expect.stringContaining('/ask'),
        allowedMentions: safeMentions,
      }),
    ]);
    const content = fake.replies[0]?.content ?? '';
    expect(content).toContain('/forget');
    expect(content).toContain('/search');
    expect(content).toContain('/help');
    expect(content).toContain('/status');
    expect(content).toContain('/faq');
    expect(content).toContain('/reminder set');
    expect(content).toContain('/reminder list');
    expect(content).toContain('/reminder cancel');
    expect(content).toMatch(
      /1 minute[\s\S]*30 days[\s\S]*500[\s\S]*10 active/i,
    );
    expect(content).not.toMatch(/moderate|ban|kick|role/i);
    expect(content).toMatch(/cannot.*(?:administer|modify).*server/i);
    expect(content).toMatch(/cannot.*(?:tool|external action)/i);
    expect(content).toMatch(
      /history.*current.*channel|current.*channel.*history/i,
    );
  });

  it.each(['help', 'status'] as const)(
    'rejects /%s from a DM before running diagnostics',
    async (commandName) => {
      const fake = interaction({ commandName, guildId: null });
      let databaseChecks = 0;

      await handleCommand(
        fake.interaction,
        dependencies({
          healthCheck: async () => {
            databaseChecks += 1;
            return true;
          },
        }),
      );

      expect(databaseChecks).toBe(0);
      expect(fake.replies).toEqual([
        expect.objectContaining({
          content: expect.stringMatching(/server/i),
          ephemeral: true,
        }),
      ]);
    },
  );

  it('reports the configured AI provider plus database health without a model request', async () => {
    const fake = interaction({ commandName: 'status' });
    let databaseChecks = 0;

    await handleCommand(
      fake.interaction,
      dependencies({
        healthCheck: async () => {
          databaseChecks += 1;
          return true;
        },
      }),
    );

    expect(databaseChecks).toBe(1);
    expect(fake.replies).toEqual([
      expect.objectContaining({
        content: expect.stringMatching(
          /Discord: configured[\s\S]*Database: healthy[\s\S]*AI provider: Ollama[\s\S]*AI configuration: configured[\s\S]*Web search: configured[\s\S]*FAQ catalog: loaded/i,
        ),
        ephemeral: true,
        allowedMentions: safeMentions,
      }),
    ]);
  });

  it('reports poll storage and scheduler health without exposing poll configuration', async () => {
    const fake = interaction({ commandName: 'status' });
    let pollDatabaseChecks = 0;

    await handleCommand(
      fake.interaction,
      dependencies({
        pollEnabled: true,
        pollAdminUserIds: new Set(['admin-1']),
        pollController: inertPollController(),
        pollHealth: {
          store: {
            healthCheck: async () => {
              pollDatabaseChecks += 1;
              return false;
            },
          },
          scheduler: { healthy: false },
        },
      }),
    );

    expect(pollDatabaseChecks).toBe(1);
    expect(fake.replies).toEqual([
      expect.objectContaining({
        content: expect.stringMatching(
          /Polls: configured[\s\S]*Poll database: unhealthy[\s\S]*Poll scheduler: degraded/i,
        ),
        ephemeral: true,
        allowedMentions: safeMentions,
      }),
    ]);
    expect(JSON.stringify(fake.replies)).not.toMatch(/admin-1|secret/i);
  });

  it('reports configured polls as unavailable when lifecycle health is absent', async () => {
    const fake = interaction({ commandName: 'status' });

    await handleCommand(
      fake.interaction,
      dependencies({
        pollEnabled: true,
        pollAdminUserIds: new Set(['admin-1']),
        pollController: inertPollController(),
      }),
    );

    expect(fake.replies).toEqual([
      expect.objectContaining({
        content: expect.stringMatching(/Polls: unavailable/i),
        ephemeral: true,
        allowedMentions: safeMentions,
      }),
    ]);
  });

  it('reports reminder readiness and only safe aggregate counts', async () => {
    const fake = interaction({ commandName: 'status' });
    let storeChecks = 0;

    await handleCommand(
      fake.interaction,
      dependencies({
        reminderHealth: {
          store: {
            healthCheck: async () => {
              storeChecks += 1;
              return true;
            },
            statusCounts: async () => ({
              pending: 2,
              retryPending: 3,
              deliveryUncertain: 4,
              failed: 5,
            }),
          },
          scheduler: { healthy: true },
        },
      }),
    );

    expect(storeChecks).toBe(1);
    expect(fake.replies).toEqual([
      expect.objectContaining({
        content: expect.stringMatching(
          /Reminder store: healthy[\s\S]*Reminder scheduler: healthy[\s\S]*pending 2[\s\S]*retry pending 3[\s\S]*delivery uncertain 4[\s\S]*failed 5/i,
        ),
        ephemeral: true,
        allowedMentions: safeMentions,
      }),
    ]);
    expect(JSON.stringify(fake.replies)).not.toMatch(
      /reminder text|ownerUserId|channelId/i,
    );
  });

  it('reports reminder diagnostics as degraded without exposing failures', async () => {
    const fake = interaction({ commandName: 'status' });
    const internalDetail = 'database=C:\\private\\reminders.db token=secret';

    await handleCommand(
      fake.interaction,
      dependencies({
        reminderHealth: {
          store: {
            healthCheck: async () => {
              throw new Error(internalDetail);
            },
            statusCounts: async () => {
              throw new Error(internalDetail);
            },
          },
          scheduler: { healthy: false },
        },
      }),
    );

    expect(fake.replies[0]?.content).toMatch(
      /Reminder store: degraded[\s\S]*Reminder scheduler: degraded[\s\S]*Reminder counts: unavailable/i,
    );
    expect(JSON.stringify(fake.replies)).not.toContain(internalDetail);
  });

  it('returns a safe ephemeral response for an unknown command', async () => {
    const fake = interaction({ commandName: 'eject-crew' });

    await handleCommand(fake.interaction, dependencies());

    expect(fake.replies).toEqual([
      expect.objectContaining({
        content: expect.stringMatching(/unknown command/i),
        ephemeral: true,
        allowedMentions: safeMentions,
      }),
    ]);
  });
});

function interaction(
  overrides: Partial<{
    commandName: string;
    guildId: string | null;
    channelId: string;
    parentId: string | null;
    isThread: boolean;
    prompt: string;
    topic: string | null;
    userId: string;
    values: Readonly<Record<string, string | null>>;
    subcommand: 'set' | 'list' | 'cancel';
  }> = {},
): {
  readonly interaction: CommandInteraction;
  readonly deferred: ReplyPayload[];
  readonly replies: ReplyPayload[];
  readonly edits: ReplyPayload[];
  readonly followUps: ReplyPayload[];
} {
  const deferred: ReplyPayload[] = [];
  const replies: ReplyPayload[] = [];
  const edits: ReplyPayload[] = [];
  const followUps: ReplyPayload[] = [];
  const commandName = overrides.commandName ?? 'help';
  const prompt = overrides.prompt ?? 'What is the plan?';
  const topic = overrides.topic ?? null;

  return {
    deferred,
    replies,
    edits,
    followUps,
    interaction: {
      id: 'interaction-1',
      commandName,
      guildId: overrides.guildId === undefined ? 'guild-1' : overrides.guildId,
      channelId: overrides.channelId ?? 'channel-1',
      channel: {
        parentId: overrides.parentId ?? null,
        isThread: () => overrides.isThread ?? false,
      },
      user: { id: overrides.userId ?? 'user-1' },
      options: {
        getSubcommand: () => overrides.subcommand ?? 'list',
        getString: (name) => {
          if (overrides.values !== undefined && name in overrides.values) {
            return overrides.values[name] ?? null;
          }
          if (commandName === 'faq' && name === 'topic') {
            return topic;
          }
          return name === (commandName === 'search' ? 'query' : 'prompt')
            ? prompt
            : null;
        },
      },
      deferReply: async (payload) => {
        deferred.push(payload);
      },
      fetchReply: async () => ({ id: 'message-1' }),
      reply: async (payload) => {
        replies.push(payload);
      },
      editReply: async (payload) => {
        edits.push(payload);
      },
      followUp: async (payload) => {
        followUps.push(payload);
      },
    },
  };
}

function dependencies(
  overrides: Partial<{
    maxInputChars: number;
    allowedChannelIds: ReadonlySet<string>;
    ask: CommandDependencies['conversationService']['ask'];
    clear: CommandDependencies['conversationService']['clear'];
    healthCheck: CommandDependencies['store']['healthCheck'];
    tavilyApiKey: string;
    faq: FaqCatalog;
    pollEnabled: boolean;
    pollAdminUserIds: ReadonlySet<string>;
    pollController: PollController;
    pollHealth: NonNullable<CommandDependencies['pollHealth']>;
    reminderService: CommandDependencies['reminderService'];
    reminderHealth: CommandDependencies['reminderHealth'];
  }> = {},
): CommandDependencies {
  return {
    config: {
      discord: {
        token: 'discord-token',
        clientId: 'client-1',
        guildId: 'guild-1',
      },
      openai: { apiKey: 'openai-key' },
      ai: { provider: 'ollama' },
      ollama: {
        baseUrl: 'http://127.0.0.1:11434',
        model: 'qwen3:8b',
      },
      webSearch: { apiKey: overrides.tavilyApiKey ?? 'tvly-secret' },
      security: {
        allowedChannelIds: overrides.allowedChannelIds ?? new Set<string>(),
        maxInputChars: overrides.maxInputChars ?? 100,
      },
      ...(overrides.pollEnabled === undefined
        ? {}
        : {
            polls: {
              enabled: overrides.pollEnabled,
              adminUserIds: overrides.pollAdminUserIds ?? new Set<string>(),
            },
          }),
    },
    conversationService: {
      ask:
        overrides.ask ??
        (async () => ({ status: 'success', text: 'Default response.' })),
      clear: overrides.clear ?? (async () => 0),
    },
    store: {
      healthCheck: overrides.healthCheck ?? (async () => true),
    },
    reminderService: overrides.reminderService ?? inertReminderService(),
    reminderHealth:
      overrides.reminderHealth ??
      ({
        store: {
          healthCheck: async () => true,
          statusCounts: async () => ({
            pending: 0,
            retryPending: 0,
            deliveryUncertain: 0,
            failed: 0,
          }),
        },
        scheduler: { healthy: true },
      } as CommandDependencies['reminderHealth']),
    faq:
      overrides.faq ??
      faqCatalog([
        {
          id: 'capabilities',
          label: 'Jarvis capabilities',
          question: 'What can Jarvis do?',
          answer: 'Jarvis is an advisory AI, not a command deck.',
        },
      ]),
    ...(overrides.pollController === undefined
      ? {}
      : { pollController: overrides.pollController }),
    ...(overrides.pollHealth === undefined
      ? {}
      : { pollHealth: overrides.pollHealth }),
  };
}

function faqCatalog(entries: readonly FaqEntry[]): FaqCatalog {
  const entriesById = new Map(
    entries.map((entry) => [entry.id.trim().toLowerCase(), entry]),
  );

  return {
    entries,
    get: (id) => entriesById.get(id.trim().toLowerCase()),
  };
}

function inertPollController(): PollController {
  return {
    create: async () => undefined,
    vote: async () => undefined,
    close: async () => undefined,
    synchronize: async () => undefined,
  };
}

function inertReminderService(): CommandDependencies['reminderService'] {
  return {
    set: async () => reminder(),
    list: async () => [],
    cancel: async () => undefined,
  };
}

function reminder(overrides: Partial<ReminderView> = {}): ReminderView {
  return {
    id: 'abcdef234567',
    guildId: 'guild-1',
    channelId: 'channel-1',
    ownerUserId: 'user-1',
    message: 'Check the oven',
    dueAt: new Date('2026-07-29T15:00:00.000Z'),
    status: 'pending',
    attemptCount: 0,
    createdAt: new Date('2026-07-29T13:00:00.000Z'),
    ...overrides,
  };
}

function maximumFaqEntries(): readonly FaqEntry[] {
  return Array.from({ length: 25 }, (_, index) => {
    const number = String(index + 1);
    const labelPrefix = `Topic ${number} `;
    const questionPrefix = `Question ${number} `;

    return {
      id: `topic-${number}`,
      label: labelPrefix + 'l'.repeat(100 - labelPrefix.length),
      question: questionPrefix + 'q'.repeat(200 - questionPrefix.length),
      answer: `Approved answer ${number}.`,
    };
  });
}

function expectSafePublicChunks(
  fake: Readonly<{
    replies: readonly ReplyPayload[];
    followUps: readonly ReplyPayload[];
  }>,
  expectedContent: string,
): void {
  expect(fake.replies).toHaveLength(1);
  expect(fake.followUps.length).toBeGreaterThan(0);
  const payloads = [...fake.replies, ...fake.followUps];

  expect(payloads.map((payload) => payload.content).join('')).toBe(
    expectedContent,
  );
  for (const payload of payloads) {
    expect(payload).toEqual({
      content: expect.any(String),
      ephemeral: false,
      allowedMentions: safeMentions,
    });
    expect(payload.content?.length).toBeLessThanOrEqual(2_000);
  }
}

function faqDependencies(
  faq: FaqCatalog,
  overrides: Readonly<{ allowedChannelIds?: ReadonlySet<string> }> = {},
): CommandDependencies {
  return dependencies({
    faq,
    ...(overrides.allowedChannelIds === undefined
      ? {}
      : { allowedChannelIds: overrides.allowedChannelIds }),
    ask: vi.fn(async () => {
      throw new Error('/faq must not call conversationService.ask');
    }),
    clear: vi.fn(async () => {
      throw new Error('/faq must not call conversationService.clear');
    }),
    healthCheck: vi.fn(async () => {
      throw new Error('/faq must not call store.healthCheck');
    }),
  });
}
