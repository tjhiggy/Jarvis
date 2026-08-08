import { describe, expect, it, vi } from 'vitest';
import { handleRecapCommand } from '../src/commands/recap.js';

describe('/recap', () => {
  it('keeps preview available without a schedule but refuses scheduled opt-in', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const interaction = (subcommand: string) => ({
      guildId: 'guild-1',
      member: { roles: { cache: { has: (role: string) => role === 'admin' } } },
      options: { getSubcommand: () => subcommand },
      reply,
    });
    const dependencies = {
      enabled: true,
      channelId: 'recaps',
      schedule: '',
      adminRoleIds: new Set(['admin']),
      service: {
        preview: async () => ({
          status: 'quiet' as const,
          content: 'A quiet week.',
        }),
      } as any,
      repository: { setRecapEnabled: vi.fn() } as any,
    };

    await handleRecapCommand(interaction('preview'), dependencies);
    expect(reply).toHaveBeenLastCalledWith(
      expect.objectContaining({ content: 'A quiet week.' }),
    );
    await handleRecapCommand(interaction('enable'), dependencies);
    expect(reply).toHaveBeenLastCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Configure a weekly recap schedule'),
      }),
    );
    expect(dependencies.repository.setRecapEnabled).not.toHaveBeenCalled();
  });
});
