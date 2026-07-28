import { GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { loadPersona } from '../src/config/persona.js';
import {
  createDiscordHandlers,
  discordGatewayIntents,
  type DiscordMessage,
  type MessageHandlerDependencies,
} from '../src/discord/handlers.js';
import type { ReplyPayload } from '../src/discord/delivery.js';
import type {
  AIRequest,
  AIResponse,
  AIService,
} from '../src/openai/openai-service.js';
import { EventDeduplicator } from '../src/security/event-deduplicator.js';
import { RateLimiter } from '../src/security/rate-limiter.js';
import { ConversationService } from '../src/services/conversation-service.js';
import type {
  ConversationMessage,
  ConversationStore,
  NewConversationMessage,
} from '../src/storage/conversation-store.js';

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

  it('lets ConversationService own duplicate suppression and failed-event release', async () => {
    const fixture = await createConversationFixture();
    const first = message();
    const concurrentDuplicate = message();
    const handlers = createDiscordHandlers(
      dependencies({
        conversationService: fixture.service,
      }),
    );

    await Promise.all([
      handlers.onMessageCreate(first.message),
      handlers.onMessageCreate(concurrentDuplicate.message),
    ]);
    await handlers.onMessageCreate(message().message);

    expect(fixture.ai.requests).toHaveLength(1);
    expect(concurrentDuplicate.replies).toEqual([
      expect.objectContaining({
        content: expect.stringMatching(/already.*handled/i),
      }),
    ]);

    fixture.ai.error = new Error('temporary upstream failure');
    const failed = message({ id: 'message-2' });
    await handlers.onMessageCreate(failed.message);

    fixture.ai.error = undefined;
    const retry = message({ id: 'message-2' });
    await handlers.onMessageCreate(retry.message);

    expect(fixture.ai.requests).toHaveLength(3);
    expect(retry.replies).toEqual([
      expect.objectContaining({ content: 'Acknowledged.' }),
    ]);
  });

  it('routes a valid thread mention with its own context and parent persona', async () => {
    const fake = message({
      channelId: 'thread-7',
      parentId: 'channel-1',
      isThread: true,
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

  it('rejects a thread mention without Send Messages in Threads before doing work', async () => {
    const fake = message({
      channelId: 'thread-7',
      parentId: 'channel-1',
      isThread: true,
      canSendInThreads: false,
    });
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

  it('keeps interaction deduplication within ConversationService', async () => {
    const fixture = await createConversationFixture();
    const statuses: string[] = [];
    const interaction = { id: 'interaction-1', isChatInputCommand: () => true };
    const handlers = createDiscordHandlers(
      dependencies({
        handleCommand: async (received) => {
          const eventId = (received as Readonly<{ id: string }>).id;
          const result = await fixture.service.ask({
            eventId,
            guildId: 'guild-1',
            conversationId: 'channel-1',
            channelId: 'channel-1',
            userId: 'user-1',
            prompt: 'status report',
          });
          statuses.push(result.status);
        },
      }),
    );

    await handlers.onInteractionCreate(interaction);
    await handlers.onInteractionCreate(interaction);

    expect(statuses).toEqual(['success', 'duplicate']);
    expect(fixture.ai.requests).toHaveLength(1);
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
    isThread: boolean;
    canView: boolean;
    canReadHistory: boolean;
    canSend: boolean;
    canSendInThreads: boolean;
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
        isThread: () => overrides.isThread ?? false,
        permissionsFor: () => ({
          has: (permission) =>
            permission === PermissionFlagsBits.ViewChannel
              ? (overrides.canView ?? true)
              : permission === PermissionFlagsBits.ReadMessageHistory
                ? (overrides.canReadHistory ?? true)
                : permission === PermissionFlagsBits.SendMessages
                  ? (overrides.canSend ?? true)
                  : permission === PermissionFlagsBits.SendMessagesInThreads
                    ? (overrides.canSendInThreads ?? true)
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
    conversationService: MessageHandlerDependencies['conversationService'];
    handleCommand: MessageHandlerDependencies['handleCommand'];
  }> = {},
): MessageHandlerDependencies {
  return {
    botUserId: 'bot-1',
    allowedChannelIds: new Set(['channel-1']),
    conversationService: overrides.conversationService ?? {
      ask:
        overrides.ask ??
        (async () => ({ status: 'success' as const, text: 'Acknowledged.' })),
    },
    handleCommand: overrides.handleCommand ?? (async () => {}),
  };
}

async function createConversationFixture(): Promise<{
  readonly ai: HandlerAI;
  readonly service: ConversationService;
}> {
  const ai = new HandlerAI();
  const deduplicator = new EventDeduplicator(60_000, 100);
  const service = new ConversationService({
    store: new HandlerStore(),
    ai,
    rateLimiter: new RateLimiter(10, 60_000),
    deduplicator,
    persona: await loadPersona('config/jarvis-persona.md'),
    allowedChannelIds: new Set(['channel-1']),
    restrainedChannelIds: new Set(),
    maxInputChars: 12_000,
    maxHistoryMessages: 20,
    safetyIdentifierSecret: 'test-secret',
  });

  return { ai, service };
}

class HandlerStore implements ConversationStore {
  async append(messageToAppend: NewConversationMessage): Promise<void> {
    void messageToAppend;
  }

  async getRecent(
    guildId: string,
    conversationId: string,
    limit: number,
  ): Promise<ConversationMessage[]> {
    void guildId;
    void conversationId;
    void limit;
    return [];
  }

  async clear(guildId: string, conversationId: string): Promise<number> {
    void guildId;
    void conversationId;
    return 0;
  }

  async cleanup(before: Date): Promise<number> {
    void before;
    return 0;
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {}
}

class HandlerAI implements AIService {
  readonly requests: AIRequest[] = [];
  error: Error | undefined;

  async respond(request: AIRequest): Promise<AIResponse> {
    this.requests.push(request);
    if (this.error !== undefined) {
      throw this.error;
    }

    return { text: 'Acknowledged.' };
  }
}
