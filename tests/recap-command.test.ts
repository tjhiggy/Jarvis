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

  it('fails closed in a DM without previewing or mutating recap state', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const preview = vi.fn();
    const setRecapEnabled = vi.fn();
    await handleRecapCommand(
      {
        guildId: null,
        member: {
          roles: { cache: { has: (role: string) => role === 'admin' } },
        },
        options: { getSubcommand: () => 'preview' },
        reply,
      },
      {
        enabled: true,
        channelId: 'recaps',
        schedule: 'Sunday 18:00',
        adminRoleIds: new Set(['admin']),
        service: { preview } as any,
        repository: { setRecapEnabled } as any,
      },
    );
    expect(preview).not.toHaveBeenCalled();
    expect(setRecapEnabled).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        ephemeral: true,
        content: expect.stringMatching(/server channel/i),
      }),
    );
  });

  it('keeps weekly recap controls administrator-only', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const preview = vi.fn();
    const setRecapEnabled = vi.fn();
    await handleRecapCommand(
      {
        guildId: 'guild-1',
        member: { roles: { cache: { has: () => false } } },
        options: { getSubcommand: () => 'enable' },
        reply,
      },
      {
        enabled: true,
        channelId: 'recaps',
        schedule: 'Sunday 18:00',
        adminRoleIds: new Set(['admin']),
        service: { preview } as any,
        repository: { setRecapEnabled } as any,
      },
    );
    expect(preview).not.toHaveBeenCalled();
    expect(setRecapEnabled).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        ephemeral: true,
        content: expect.stringMatching(
          /restricted to configured MuthaShip administrators/i,
        ),
      }),
    );
  });

  it('reports unconfigured recaps without calling preview', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const preview = vi.fn();
    await handleRecapCommand(
      {
        guildId: 'guild-1',
        member: {
          roles: { cache: { has: (role: string) => role === 'admin' } },
        },
        options: { getSubcommand: () => 'preview' },
        reply,
      },
      {
        enabled: false,
        channelId: 'recaps',
        schedule: 'Sunday 18:00',
        adminRoleIds: new Set(['admin']),
        service: { preview } as any,
        repository: { setRecapEnabled: vi.fn() } as any,
      },
    );
    expect(preview).not.toHaveBeenCalled();
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        ephemeral: true,
        content: expect.stringMatching(/not configured/i),
      }),
    );
  });

  it('resumes scheduled recaps when a weekly schedule is configured', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const setRecapEnabled = vi.fn().mockResolvedValue(undefined);
    await handleRecapCommand(
      {
        guildId: 'guild-1',
        member: {
          roles: { cache: { has: (role: string) => role === 'admin' } },
        },
        options: { getSubcommand: () => 'resume' },
        reply,
      },
      {
        enabled: true,
        channelId: 'recaps',
        schedule: 'Sunday 18:00 America/New_York',
        adminRoleIds: new Set(['admin']),
        service: {
          preview: async () => ({
            status: 'quiet' as const,
            content: 'unused',
          }),
        } as any,
        repository: { setRecapEnabled } as any,
      },
    );
    expect(setRecapEnabled).toHaveBeenCalledWith(
      'guild-1',
      true,
      expect.any(Date),
    );
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Weekly recaps are enabled for this MuthaShip.',
      }),
    );
  });

  it('does not invent recap copy when preview source data is missing', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleRecapCommand(
      {
        guildId: 'guild-1',
        member: {
          roles: { cache: { has: (role: string) => role === 'admin' } },
        },
        options: { getSubcommand: () => 'preview' },
        reply,
      },
      {
        enabled: true,
        channelId: 'recaps',
        schedule: 'Sunday 18:00',
        adminRoleIds: new Set(['admin']),
        service: {
          preview: async () => ({
            status: 'unavailable' as const,
            content: undefined,
          }),
        } as any,
        repository: { setRecapEnabled: vi.fn() } as any,
      },
    );
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        ephemeral: true,
        content:
          'Recap source data is unavailable, so Jarvis will not publish a recap.',
      }),
    );
  });

  it('allows an administrator to pause without a schedule', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const setRecapEnabled = vi.fn().mockResolvedValue(undefined);
    await handleRecapCommand(
      {
        guildId: 'guild-1',
        member: {
          roles: { cache: { has: (role: string) => role === 'admin' } },
        },
        options: { getSubcommand: () => 'pause' },
        reply,
      },
      {
        enabled: true,
        channelId: 'recaps',
        schedule: '',
        adminRoleIds: new Set(['admin']),
        service: {
          preview: async () => ({
            status: 'quiet' as const,
            content: 'unused',
          }),
        } as any,
        repository: { setRecapEnabled } as any,
      },
    );
    expect(setRecapEnabled).toHaveBeenCalledWith(
      'guild-1',
      false,
      expect.any(Date),
    );
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'Weekly recaps are paused for this MuthaShip.',
      }),
    );
  });
});
