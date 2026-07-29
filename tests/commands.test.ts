import { describe, expect, it, vi } from 'vitest';
import { createCommandDefinitions } from '../src/commands/definitions.js';
import type { FaqCatalog, FaqEntry } from '../src/faq/faq-catalog.js';
import {
  handleCommand,
  type CommandDependencies,
  type CommandInteraction,
  type ReplyPayload,
} from '../src/commands/handlers.js';
import { isAllowedChannel } from '../src/discord/access.js';

const safeMentions = { parse: [], repliedUser: false };

describe('command definitions', () => {
  it('publishes the supported commands with configured question limits and approved FAQ topics', () => {
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
      user: { id: 'user-1' },
      options: {
        getString: (name) => {
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
