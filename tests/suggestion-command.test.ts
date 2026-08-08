import { describe, expect, it } from 'vitest';
import {
  handleSuggestionCommand,
  handleSuggestionDeletionCommand,
} from '../src/commands/suggestion.js';

describe('suggestion commands', () => {
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

function interaction(subcommand: string, strings: Record<string, string>) {
  const replies: any[] = [];
  return {
    guildId: 'guild-1',
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
