import { describe, expect, it } from 'vitest';
import {
  createDiscordHandlers,
  parseSuggestionCustomId,
} from '../src/discord/handlers.js';

describe('suggestion button routing', () => {
  it('routes only configured bot-owned cards and extracts configured role cache membership', async () => {
    const calls: unknown[] = [];
    const interaction = button();
    await createDiscordHandlers(dependencies(calls)).onInteractionCreate(
      interaction as any,
    );

    expect(
      parseSuggestionCustomId('suggestion:v1:suggestion-1:resolve'),
    ).toEqual({ suggestionId: 'suggestion-1', action: 'resolve' });
    expect(calls).toEqual([
      expect.objectContaining({
        guildId: 'guild-1',
        channelId: 'suggestions',
        suggestionId: 'suggestion-1',
        action: 'resolve',
        moderatorRoleIds: new Set(['role-admin']),
      }),
    ]);
    expect(interaction.edits).toEqual([
      expect.objectContaining({ content: 'Suggestion marked resolved.' }),
    ]);
  });

  it.each([
    ['wrong configured channel', { channelId: 'other-channel' }],
    ['non-bot card author', { authorId: 'other-bot' }],
    ['malformed custom id', { customId: 'suggestion:v1:bad:explode' }],
  ])('rejects %s before suggestion moderation', async (_name, overrides) => {
    const calls: unknown[] = [];
    const interaction = button(overrides);
    await createDiscordHandlers(dependencies(calls)).onInteractionCreate(
      interaction as any,
    );

    expect(calls).toEqual([]);
    expect(interaction.replies).toEqual([
      expect.objectContaining({
        content: expect.stringMatching(/unavailable/i),
        ephemeral: true,
      }),
    ]);
  });
});

function dependencies(calls: unknown[]) {
  return {
    botUserId: 'bot-1',
    allowedChannelIds: new Set(['channel-1']),
    conversationService: {
      ask: async () => ({ status: 'success' as const, text: 'unused' }),
    },
    handleCommand: async () => {},
    suggestionService: {
      moderate: async (input: unknown) => {
        calls.push(input);
        return { status: 'resolved' };
      },
    } as any,
    engagementAdminRoleIds: new Set(['role-admin']),
    suggestionChannelId: 'suggestions',
  };
}

function button(
  overrides: Partial<{
    channelId: string;
    authorId: string;
    customId: string;
  }> = {},
) {
  const replies: any[] = [];
  const edits: any[] = [];
  return {
    id: 'button-1',
    customId: overrides.customId ?? 'suggestion:v1:suggestion-1:resolve',
    guildId: 'guild-1',
    channelId: overrides.channelId ?? 'suggestions',
    isChatInputCommand: () => false,
    isButton: () => true,
    user: { id: 'admin-1' },
    member: { roles: { cache: { has: (id: string) => id === 'role-admin' } } },
    channel: { parentId: null, isThread: () => false },
    message: {
      id: 'message-1',
      guildId: 'guild-1',
      channelId: overrides.channelId ?? 'suggestions',
      author: { id: overrides.authorId ?? 'bot-1' },
    },
    replies,
    edits,
    reply: async (payload: any) => {
      replies.push(payload);
    },
    deferReply: async () => undefined,
    editReply: async (payload: any) => {
      edits.push(payload);
    },
  };
}
