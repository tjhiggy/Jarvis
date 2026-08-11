import { describe, expect, it, vi } from 'vitest';
import { handleFeatureRequestCommand } from '../src/commands/feature-request.js';

const interaction = (
  subcommand: string,
  values: Record<string, string> = {},
  admin = true,
) => {
  const replies: unknown[] = [];
  return {
    replies,
    value: {
      guildId: 'server-1',
      channelId: 'channel-1',
      user: { id: 'admin-1' },
      member: {
        roles: { cache: { has: (id: string) => admin && id === 'role-1' } },
      },
      options: {
        getSubcommand: () => subcommand,
        getString: (name: string) => values[name] ?? null,
      },
      reply: async (payload: unknown) => replies.push(payload),
      deferReply: async (payload: unknown) => replies.push(payload),
      editReply: async (payload: unknown) => replies.push(payload),
      followUp: async (payload: unknown) => replies.push(payload),
    },
  };
};

describe('/feature-request', () => {
  it('allows configured administrators to preview a private request', async () => {
    const service = {
      preview: vi.fn(() => ({
        id: 'draft-1',
        serverId: 'server-1',
        channelId: 'channel-1',
        ownerId: 'admin-1',
        title: 'Better onboarding',
        description: 'Make onboarding easier.',
        createdAt: new Date('2026-08-11T18:00:00Z'),
      })),
      confirm: vi.fn(),
      cancel: vi.fn(),
    };
    const command = interaction('preview', {
      title: 'Better onboarding',
      description: 'Make onboarding easier.',
    });

    await handleFeatureRequestCommand(command.value, {
      adminRoleIds: new Set(['role-1']),
      service,
    });

    expect(service.preview).toHaveBeenCalledOnce();
    expect(command.replies[0]).toMatchObject({ ephemeral: true });
    expect(JSON.stringify(command.replies[0])).toContain('draft-1');
  });

  it('denies non-administrators without creating a draft', async () => {
    const service = { preview: vi.fn(), confirm: vi.fn(), cancel: vi.fn() };
    const command = interaction('preview', {}, false);

    await handleFeatureRequestCommand(command.value, {
      adminRoleIds: new Set(['role-1']),
      service,
    });

    expect(service.preview).not.toHaveBeenCalled();
    expect(JSON.stringify(command.replies[0])).toMatch(/administrator/i);
  });

  it('defers before confirming the GitHub issue', async () => {
    const order: string[] = [];
    const service = {
      preview: vi.fn(),
      confirm: vi.fn(async () => {
        order.push('confirm');
        return {
          number: 212,
          url: 'https://github.com/tjhiggy/Jarvis/issues/212',
        };
      }),
      cancel: vi.fn(),
    };
    const command = interaction('confirm', { draft_id: 'draft-1' });
    command.value.deferReply = async (payload: unknown) => {
      order.push('defer');
      return command.replies.push(payload);
    };

    await handleFeatureRequestCommand(command.value, {
      adminRoleIds: new Set(['role-1']),
      service,
    });

    expect(order).toEqual(['defer', 'confirm']);
    expect(command.replies[0]).toMatchObject({ ephemeral: true });
    expect(JSON.stringify(command.replies.at(-1))).toContain('issue #212');
  });
});
