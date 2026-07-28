import { GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';
import {
  createDiscordHandlers,
  discordGatewayIntents,
  type DiscordMessage,
  type MessageHandlerDependencies,
} from '../src/discord/handlers.js';
import type { ReplyPayload } from '../src/discord/delivery.js';

describe('Discord event routing', () => {
  it('declares only the gateway intents required for guild mention handling', () => {
    expect(discordGatewayIntents).toEqual([
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ]);
  });

  it.each([
    ['bot-authored messages', { authorBot: true }],
    ['DMs', { guildId: null }],
    ['non-mentions', { mentioned: false }],
    ['empty prompts', { content: '<@bot-1>   ' }],
    ['disallowed channels', { channelId: 'not-allowed' }],
    ['missing bot permissions', { canSend: false }],
  ])(
    'ignores %s before the conversation service',
    async (_caseName, overrides) => {
      const fake = message(overrides);
      let requests = 0;

      await createDiscordHandlers(
        dependencies({
          ask: async () => {
            requests += 1;
            return { status: 'success', text: 'This must not send.' };
          },
        }),
      ).onMessageCreate(fake.message);

      expect(requests).toBe(0);
      expect(fake.replies).toEqual([]);
    },
  );

  it('suppresses duplicate message IDs before the conversation service', async () => {
    const fake = message();
    let requests = 0;
    const handlers = createDiscordHandlers(
      dependencies({
        ask: async () => {
          requests += 1;
          return { status: 'success', text: 'Acknowledged.' };
        },
      }),
    );

    await handlers.onMessageCreate(fake.message);
    await handlers.onMessageCreate(fake.message);

    expect(requests).toBe(1);
    expect(fake.replies).toHaveLength(1);
  });

  it('routes a valid thread mention with its own context and parent persona', async () => {
    const fake = message({
      channelId: 'thread-7',
      parentId: 'channel-1',
      content: '<@bot-1> inspect <@other-user> please',
    });
    const requests: unknown[] = [];

    await createDiscordHandlers(
      dependencies({
        ask: async (request) => {
          requests.push(request);
          return {
            status: 'success',
            text: '@everyone thread report ' + 'x'.repeat(2_100),
          };
        },
      }),
    ).onMessageCreate(fake.message);

    expect(requests).toEqual([
      {
        eventId: 'message-1',
        guildId: 'guild-1',
        conversationId: 'thread-7',
        channelId: 'thread-7',
        parentChannelId: 'channel-1',
        userId: 'user-1',
        prompt: 'inspect <@other-user> please',
      },
    ]);
    expect(fake.replies.length).toBeGreaterThan(1);
    expect(fake.replies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: expect.stringContaining('@\u200beveryone'),
          allowedMentions: { parse: [], repliedUser: false },
        }),
      ]),
    );
    expect(
      fake.replies.every(({ content }) => (content?.length ?? 0) <= 1_900),
    ).toBe(true);
  });

  it('sends only a safe generic error when conversation handling throws', async () => {
    const fake = message();
    const internalDetail = 'prompt content should never surface';

    await createDiscordHandlers(
      dependencies({
        ask: async () => {
          throw new Error(internalDetail);
        },
      }),
    ).onMessageCreate(fake.message);

    expect(fake.replies).toEqual([
      expect.objectContaining({
        content: expect.stringMatching(/could not be completed/i),
        allowedMentions: { parse: [], repliedUser: false },
      }),
    ]);
    expect(fake.replies[0]?.content).not.toContain(internalDetail);
  });

  it('passes chat-input interactions to the injected command handler', async () => {
    const interaction = {
      isChatInputCommand: () => true,
      id: 'interaction-1',
    };
    const handled: unknown[] = [];

    await createDiscordHandlers(
      dependencies({
        handleCommand: async (received) => {
          handled.push(received);
        },
      }),
    ).onInteractionCreate(interaction);

    expect(handled).toEqual([interaction]);
  });

  it('ignores non-command interactions', async () => {
    let handled = 0;

    await createDiscordHandlers(
      dependencies({
        handleCommand: async () => {
          handled += 1;
        },
      }),
    ).onInteractionCreate({ isChatInputCommand: () => false });

    expect(handled).toBe(0);
  });
});

function message(
  overrides: Partial<{
    id: string;
    authorBot: boolean;
    guildId: string | null;
    mentioned: boolean;
    content: string;
    channelId: string;
    parentId: string | null;
    canView: boolean;
    canReadHistory: boolean;
    canSend: boolean;
  }> = {},
): { readonly message: DiscordMessage; readonly replies: Reply[] } {
  const replies: Reply[] = [];
  const mentioned = overrides.mentioned ?? true;

  return {
    replies,
    message: {
      id: overrides.id ?? 'message-1',
      content: overrides.content ?? '<@bot-1> status report',
      guildId: overrides.guildId === undefined ? 'guild-1' : overrides.guildId,
      channelId: overrides.channelId ?? 'channel-1',
      channel: {
        parentId: overrides.parentId ?? null,
        permissionsFor: () => ({
          has: (permission) =>
            permission === PermissionFlagsBits.ViewChannel
              ? (overrides.canView ?? true)
              : permission === PermissionFlagsBits.ReadMessageHistory
                ? (overrides.canReadHistory ?? true)
                : permission === PermissionFlagsBits.SendMessages
                  ? (overrides.canSend ?? true)
                  : false,
        }),
      },
      author: { id: 'user-1', bot: overrides.authorBot ?? false },
      mentions: { users: { has: (userId) => mentioned && userId === 'bot-1' } },
      reply: async (reply) => {
        replies.push(reply);
      },
    },
  };
}

type Reply = ReplyPayload;

function dependencies(
  overrides: Partial<{
    ask: MessageHandlerDependencies['conversationService']['ask'];
    handleCommand: MessageHandlerDependencies['handleCommand'];
  }> = {},
): MessageHandlerDependencies {
  const seen = new Set<string>();
  return {
    botUserId: 'bot-1',
    allowedChannelIds: new Set(['channel-1']),
    conversationService: {
      ask:
        overrides.ask ??
        (async () => ({ status: 'success', text: 'Acknowledged.' })),
    },
    deduplicator: {
      accept: (eventId) => {
        if (seen.has(eventId)) {
          return false;
        }
        seen.add(eventId);
        return true;
      },
      release: (eventId) => {
        seen.delete(eventId);
      },
    },
    handleCommand: overrides.handleCommand ?? (async () => {}),
  };
}
