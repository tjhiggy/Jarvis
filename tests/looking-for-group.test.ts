import { describe, expect, it, vi } from 'vitest';
import { handleLookingForGroupCommand } from '../src/commands/looking-for-group.js';

const interaction = (values: Record<string, string | null>) => ({
  guildId: 'ship',
  user: { id: 'u1', globalName: 'UselessBoi' },
  options: { getString: (name: string) => values[name] ?? null },
  reply: vi.fn(async () => undefined),
});

describe('looking for group command', () => {
  it('posts a concise crew signal using the member display name', async () => {
    const value = interaction({
      game: 'Fortnite',
      when: 'tonight',
      details: 'Zero Build',
    });
    await handleLookingForGroupCommand(value, {
      enabled: true,
      channelId: 'activity',
    });
    expect(value.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('UselessBoi is looking for a group'),
        allowedMentions: { parse: [], repliedUser: false },
      }),
    );
  });

  it('rejects empty game names without posting', async () => {
    const value = interaction({ game: '  ' });
    await handleLookingForGroupCommand(value, {
      enabled: true,
      channelId: 'activity',
    });
    expect(value.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('which game'),
      }),
    );
  });
});
