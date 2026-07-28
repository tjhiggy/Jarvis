import { describe, expect, it } from 'vitest';
import { createCommandDefinitions } from '../src/commands/definitions.js';
import {
  handleCommand,
  type CommandDependencies,
  type CommandInteraction,
  type ReplyPayload,
} from '../src/commands/handlers.js';
import { isAllowedChannel } from '../src/discord/access.js';

const safeMentions = { parse: [], repliedUser: false };

describe('command definitions', () => {
  it('publishes only the four supported commands with the configured prompt limit', () => {
    const definitions = createCommandDefinitions(123);

    expect(definitions.map((definition) => definition.name)).toEqual([
      'ask',
      'forget',
      'help',
      'status',
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
  });

  it('caps the slash-command prompt at Discord string-option limits', () => {
    const definitions = createCommandDefinitions(12_000);

    expect(definitions[0]?.options?.[0]?.max_length).toBe(6_000);
  });
});

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
        clear: async (guildId, conversationId) => {
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
    expect(content).toContain('/help');
    expect(content).toContain('/status');
    expect(content).not.toMatch(/moderate|ban|kick|role/i);
  });

  it('reports configured Discord and OpenAI plus database health without a model request', async () => {
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
          /Discord: configured[\s\S]*Database: healthy[\s\S]*OpenAI: configured/i,
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
    prompt: string;
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
      channel: { parentId: overrides.parentId ?? null },
      user: { id: 'user-1' },
      options: { getString: (name) => (name === 'prompt' ? prompt : null) },
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
    ask: CommandDependencies['conversationService']['ask'];
    clear: CommandDependencies['store']['clear'];
    healthCheck: CommandDependencies['store']['healthCheck'];
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
      security: {
        allowedChannelIds: new Set<string>(),
        maxInputChars: overrides.maxInputChars ?? 100,
      },
    },
    conversationService: {
      ask:
        overrides.ask ??
        (async () => ({ status: 'success', text: 'Default response.' })),
    },
    store: {
      clear: overrides.clear ?? (async () => 0),
      healthCheck: overrides.healthCheck ?? (async () => true),
    },
  };
}
