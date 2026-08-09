import { describe, expect, it } from 'vitest';
import {
  createDiscordHandlers,
  parsePreviewCustomId,
} from '../src/discord/handlers.js';

describe('engagement preview buttons', () => {
  it('routes an owner-bound introduction confirmation once and replies privately', async () => {
    const confirms: unknown[] = [];
    const interaction = button('preview:v1:introduction:draft-1:confirm');
    const handlers = createDiscordHandlers({
      ...dependencies(),
      introductionService: {
        confirm: async (value: unknown) => {
          confirms.push(value);
          return { id: 'introduction-1' };
        },
        cancel: () => false,
      } as any,
    });

    await Promise.all([
      handlers.onInteractionCreate(interaction),
      handlers.onInteractionCreate(interaction),
    ]);

    expect(confirms).toEqual([
      { guildId: 'guild-1', ownerUserId: 'owner-1', draftId: 'draft-1' },
    ]);
    expect(interaction.deferred).toEqual([{ ephemeral: true }]);
    expect(interaction.edits).toEqual([
      expect.objectContaining({
        content: expect.stringMatching(/posted/i),
        allowedMentions: { parse: [], repliedUser: false },
      }),
    ]);
  });

  it.each([
    ['another member', { userId: 'intruder-1' }],
    ['another guild', { guildId: 'guild-2', messageGuildId: 'guild-2' }],
  ])('does not confirm a preview from %s', async (_label, overrides) => {
    const interaction = button(
      'preview:v1:suggestion:draft-1:confirm',
      overrides,
    );
    const handlers = createDiscordHandlers({
      ...dependencies(),
      suggestionService: {
        confirm: async (value: { ownerUserId: string; guildId: string }) => {
          if (value.ownerUserId !== 'owner-1' || value.guildId !== 'guild-1')
            throw new Error('not owned');
          return { id: 'suggestion-1' };
        },
        cancel: () => false,
      } as any,
    });

    await handlers.onInteractionCreate(interaction);

    expect(interaction.edits).toEqual([
      expect.objectContaining({
        content: expect.stringMatching(/could not be completed/i),
      }),
    ]);
  });

  it('recognizes only bounded preview button IDs', () => {
    expect(
      parsePreviewCustomId('preview:v1:introduction:draft-1:cancel'),
    ).toEqual({
      kind: 'introduction',
      draftId: 'draft-1',
      action: 'cancel',
    });
    expect(
      parsePreviewCustomId(
        'preview:v1:introduction:' + 'x'.repeat(65) + ':confirm',
      ),
    ).toBeUndefined();
  });
});

function dependencies() {
  return {
    botUserId: 'bot-1',
    allowedChannelIds: new Set(['channel-1']),
    conversationService: {
      ask: async () => ({ status: 'success' as const, text: 'ok' }),
    },
    handleCommand: async () => undefined,
  };
}

function button(
  customId: string,
  overrides: Partial<{
    userId: string;
    guildId: string;
    messageGuildId: string;
  }> = {},
) {
  const deferred: unknown[] = [];
  const edits: unknown[] = [];
  return {
    id: 'button-1',
    isChatInputCommand: () => false,
    isButton: () => true,
    customId,
    guildId: overrides.guildId ?? 'guild-1',
    channelId: 'channel-1',
    channel: { parentId: null, isThread: () => false },
    user: { id: overrides.userId ?? 'owner-1' },
    message: {
      id: 'message-1',
      guildId: overrides.messageGuildId ?? 'guild-1',
      channelId: 'channel-1',
      author: { id: 'bot-1' },
    },
    deferred,
    edits,
    reply: async () => undefined,
    deferReply: async (payload: unknown) => void deferred.push(payload),
    editReply: async (payload: unknown) => void edits.push(payload),
  };
}
