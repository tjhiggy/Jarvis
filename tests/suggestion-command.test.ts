import { describe, expect, it, vi } from 'vitest';
import {
  handleSuggestionCommand,
  handleSuggestionDeletionCommand,
} from '../src/commands/suggestion.js';

describe('suggestion commands', () => {
  it('fails closed from a DM without previewing or posting', async () => {
    const preview = vi.fn();
    const missing = interaction(
      'preview',
      {
        title: 'Movie night',
        description: 'Weekly crew movie.',
      },
      null,
    );
    await handleSuggestionCommand(missing, {
      enabled: true,
      channelId: 'suggestions',
      service: { preview } as any,
    });
    expect(preview).not.toHaveBeenCalled();
    expect(missing.replies[0]).toMatchObject({
      ephemeral: true,
      content: expect.stringMatching(/server channel/i),
    });
  });

  it('cancels only an owned draft and reports a missing draft without posting', async () => {
    const cancel = vi.fn(
      (input: { draftId: string }) => input.draftId === 'draft-1',
    );
    const owned = interaction('cancel', { draft_id: 'draft-1' });
    await handleSuggestionCommand(owned, {
      enabled: true,
      channelId: 'suggestions',
      service: { cancel } as any,
    });
    expect(owned.replies[0]).toMatchObject({
      ephemeral: true,
      content: expect.stringMatching(/nothing was saved or posted/i),
    });

    const missing = interaction('cancel', { draft_id: 'draft-2' });
    await handleSuggestionCommand(missing, {
      enabled: true,
      channelId: 'suggestions',
      service: { cancel } as any,
    });
    expect(missing.replies[0]).toMatchObject({
      ephemeral: true,
      content: expect.stringMatching(/not found or is not yours/i),
    });
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it('shows a private preview and confirms it only for the draft owner', async () => {
    const calls: unknown[] = [];
    const service = {
      preview: async (value: unknown) => {
        calls.push(value);
        return {
          id: 'draft-1',
          title: 'Movie night',
          description: 'Weekly crew movie.',
          status: 'open',
        };
      },
      confirm: async () => ({ id: 'suggestion-1' }),
      cancel: () => true,
    } as any;
    const preview = interaction('preview', {
      title: 'Movie night',
      description: 'Weekly crew movie.',
    });
    await handleSuggestionCommand(preview, {
      enabled: true,
      channelId: 'suggestions',
      service,
    });
    expect(calls).toEqual([
      expect.objectContaining({
        channelId: 'suggestions',
        ownerUserId: 'user-1',
      }),
    ]);
    expect(preview.replies[0]).toMatchObject({
      ephemeral: true,
      content: expect.stringMatching(/nothing has been saved/i),
      allowedMentions: { parse: [], repliedUser: false },
      components: [
        {
          components: [
            expect.objectContaining({
              label: 'Confirm',
              custom_id: 'preview:v1:suggestion:draft-1:confirm',
            }),
            expect.objectContaining({
              label: 'Cancel',
              custom_id: 'preview:v1:suggestion:draft-1:cancel',
            }),
          ],
        },
      ],
    });

    const confirm = interaction('confirm', { draft_id: 'draft-1' });
    await handleSuggestionCommand(confirm, {
      enabled: true,
      channelId: 'suggestions',
      service,
    });
    expect(confirm.replies[0]).toMatchObject({
      ephemeral: true,
      content: expect.stringMatching(/posted/i),
    });
  });

  it('keeps deletion private and reports missing configuration safely', async () => {
    const missing = interaction('preview', {
      title: 'Movie night',
      description: 'Weekly crew movie.',
    });
    await handleSuggestionCommand(missing, { enabled: false, channelId: '' });
    expect(missing.replies[0]).toMatchObject({
      ephemeral: true,
      content: expect.stringMatching(/not configured/i),
    });

    const deletion = interaction('delete', { id: 'suggestion-1' });
    await handleSuggestionDeletionCommand(deletion, {
      delete: async () => true,
    } as any);
    expect(deletion.replies[0]).toMatchObject({
      ephemeral: true,
      content: expect.stringMatching(/removed/i),
    });
  });
});

function interaction(
  subcommand: string,
  strings: Record<string, string>,
  guildId: string | null = 'guild-1',
) {
  const replies: any[] = [];
  return {
    guildId,
    user: { id: 'user-1' },
    options: {
      getSubcommand: () => subcommand,
      getString: (name: string) => strings[name] ?? null,
    },
    replies,
    reply: async (payload: any) => {
      replies.push(payload);
    },
  };
}
