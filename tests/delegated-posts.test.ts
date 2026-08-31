import { describe, expect, it } from 'vitest';
import {
  handleCommand,
  type CommandDependencies,
  type CommandInteraction,
  type ReplyPayload,
} from '../src/commands/handlers.js';
import {
  DelegatedPostError,
  DelegatedPostService,
} from '../src/engagement/delegated-posts.js';

describe('delegated post command configuration', () => {
  it('previews and confirms for a guild interaction when channel and admin roles are configured', async () => {
    const { service, sent } = setup(new Set(['admin-role']));
    const preview = postInteraction({
      guildId: 'guild-1',
      roleIds: ['admin-role'],
    });
    await handleCommand(
      preview.interaction,
      commandDependencies({
        service,
        activityId: 'activity-channel',
        adminRoleIds: new Set(['admin-role']),
        engagementEnabled: false,
      }),
    );
    expect(preview.replies[0]).toMatchObject({
      ephemeral: true,
      content: expect.stringMatching(/nothing has been posted/i),
      embeds: [
        expect.objectContaining({ title: 'Review MuthaShip transmission' }),
      ],
    });

    const confirm = postInteraction({
      guildId: 'guild-1',
      roleIds: ['admin-role'],
      subcommand: 'confirm',
      values: { draft_id: 'draft-1' },
    });
    await handleCommand(
      confirm.interaction,
      commandDependencies({
        service,
        activityId: 'activity-channel',
        adminRoleIds: new Set(['admin-role']),
        engagementEnabled: false,
      }),
    );
    expect(confirm.replies[0]).toMatchObject({
      ephemeral: true,
      content: expect.stringMatching(
        /transmission posted to the test channel/i,
      ),
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.embeds?.[0]).toMatchObject({
      title: 'MuthaShip transmission',
      fields: [expect.objectContaining({ name: 'Sent by' })],
    });
  });

  it('previews and confirms without interaction.guildId using the configured guild', async () => {
    const { service, sent } = setup(new Set(['admin-role']));
    const preview = postInteraction({
      guildId: null,
      roleIds: ['admin-role'],
    });
    await handleCommand(
      preview.interaction,
      commandDependencies({
        service,
        activityId: 'activity-channel',
        adminRoleIds: new Set(['admin-role']),
        configuredGuildId: 'configured-guild',
      }),
    );
    expect(preview.replies[0]).toMatchObject({
      ephemeral: true,
      content: expect.stringMatching(/nothing has been posted/i),
    });
    expect(preview.replies[0]?.content).not.toMatch(/not configured/i);

    const confirm = postInteraction({
      guildId: null,
      roleIds: ['admin-role'],
      subcommand: 'confirm',
      values: { draft_id: 'draft-1' },
    });
    await handleCommand(
      confirm.interaction,
      commandDependencies({
        service,
        activityId: 'activity-channel',
        adminRoleIds: new Set(['admin-role']),
        configuredGuildId: 'configured-guild',
      }),
    );
    expect(confirm.replies[0]).toMatchObject({
      ephemeral: true,
      content: expect.stringMatching(
        /transmission posted to the test channel/i,
      ),
    });
    expect(sent).toHaveLength(1);
  });

  it.each([
    [
      'missing destination channel',
      { activityId: '', adminRoleIds: new Set(['admin-role']) },
    ],
    [
      'missing admin roles',
      { activityId: 'activity-channel', adminRoleIds: new Set<string>() },
    ],
  ] as const)(
    'fails closed with the not-configured path for %s',
    async (_name, overrides) => {
      const { service, sent } = setup(new Set(['admin-role']));
      const preview = postInteraction({
        guildId: 'guild-1',
        channelId: 'current-channel',
        roleIds: ['admin-role'],
      });
      await handleCommand(
        preview.interaction,
        commandDependencies({
          service,
          activityId: overrides.activityId,
          adminRoleIds: overrides.adminRoleIds,
        }),
      );
      expect(sent).toEqual([]);
      expect(preview.replies).toEqual([
        expect.objectContaining({
          ephemeral: true,
          content:
            'Delegated transmissions are not configured on the MuthaShip.',
        }),
      ]);
      expect(preview.replies[0]?.content).not.toContain('activity-channel');
      expect(preview.replies[0]?.content).not.toContain('current-channel');
      expect(preview.replies[0]?.content).not.toContain('admin-role');
    },
  );

  it('fails closed as not configured when neither the interaction nor config supplies a guild', async () => {
    const { service, sent } = setup(new Set(['admin-role']));
    const preview = postInteraction({
      guildId: null,
      roleIds: ['admin-role'],
    });

    await handleCommand(
      preview.interaction,
      commandDependencies({
        service,
        activityId: 'activity-channel',
        adminRoleIds: new Set(['admin-role']),
        configuredGuildId: '',
      }),
    );

    expect(sent).toEqual([]);
    expect(preview.replies).toEqual([
      expect.objectContaining({
        ephemeral: true,
        content: 'Delegated transmissions are not configured on the MuthaShip.',
      }),
    ]);
  });

  it('refuses a configured /post from a member without an administrator role', async () => {
    const { service, sent } = setup(new Set(['admin-role']));
    const preview = postInteraction({
      guildId: 'guild-1',
      roleIds: ['crew-role'],
    });

    await handleCommand(
      preview.interaction,
      commandDependencies({
        service,
        activityId: 'activity-channel',
        adminRoleIds: new Set(['admin-role']),
      }),
    );

    expect(sent).toEqual([]);
    expect(preview.replies).toEqual([
      expect.objectContaining({
        ephemeral: true,
        content:
          'Delegated transmissions are restricted to configured MuthaShip administrators.',
      }),
    ]);
    expect(preview.replies[0]?.content).not.toMatch(/not configured/i);
  });

  it.each([
    ['blank content', '   '],
    ['oversized content', 'x'.repeat(1_501)],
  ])(
    'maps %s to the bounded character-limit reply without posting',
    async (_name, content) => {
      const { service, sent } = setup(new Set(['admin-role']));
      const preview = postInteraction({
        guildId: 'guild-1',
        roleIds: ['admin-role'],
        values: { content },
      });

      await handleCommand(
        preview.interaction,
        commandDependencies({
          service,
          activityId: 'activity-channel',
          adminRoleIds: new Set(['admin-role']),
        }),
      );

      expect(sent).toEqual([]);
      expect(preview.replies).toEqual([
        expect.objectContaining({
          ephemeral: true,
          content: 'Use a message between 1 and 1,500 characters.',
        }),
      ]);
    },
  );
});

describe('delegated posts', () => {
  it('requires admin and creates a private draft', () => {
    const { service } = setup();
    expect(() =>
      service.preview({
        guildId: 'g',
        ownerUserId: 'u',
        ownerName: 'U',
        ownerRoleIds: new Set(),
        channelId: 'c',
        content: 'hello',
      }),
    ).toThrowError(new DelegatedPostError('forbidden'));
    const draft = service.preview({
      guildId: 'g',
      ownerUserId: 'u',
      ownerName: 'U',
      ownerRoleIds: new Set(['admin']),
      channelId: 'c',
      content: 'ping @everyone',
    });
    expect(draft.content).toBe('ping @​everyone');
  });
  it('confirms once and prevents duplicate drafts', async () => {
    const { service, sent } = setup();
    const input = {
      guildId: 'g',
      ownerUserId: 'u',
      ownerName: 'U',
      ownerRoleIds: new Set(['admin']),
      channelId: 'c',
      content: 'hello',
    };
    const draft = service.preview(input);
    expect(() => service.preview(input)).toThrowError(
      new DelegatedPostError('duplicate'),
    );
    await expect(
      service.confirm({ guildId: 'g', ownerUserId: 'u', draftId: draft.id }),
    ).resolves.toEqual({ id: 'msg-1' });
    expect(sent[0].embeds[0].title).toBe('MuthaShip transmission');
    expect(sent[0].embeds[0].fields).toContainEqual({
      name: 'Sent by',
      value: 'U',
    });
    await expect(
      service.confirm({ guildId: 'g', ownerUserId: 'u', draftId: draft.id }),
    ).rejects.toThrow();
  });
});

function setup(adminRoleIds: ReadonlySet<string> = new Set(['admin'])) {
  const sent: any[] = [];
  const service = new DelegatedPostService({
    createId: () => 'draft-1',
    adminRoleIds,
    gateway: {
      post: async (_c, card) => {
        sent.push(card);
        return { id: 'msg-1' };
      },
    },
  });
  return { service, sent };
}

function commandDependencies(
  overrides: Readonly<{
    service: DelegatedPostService;
    activityId: string;
    adminRoleIds: ReadonlySet<string>;
    configuredGuildId?: string;
    engagementEnabled?: boolean;
  }>,
): CommandDependencies {
  return {
    config: {
      discord: {
        token: 'discord-token',
        clientId: 'client-1',
        guildId: overrides.configuredGuildId ?? 'guild-1',
      },
      openai: { apiKey: 'openai-key' },
      ai: { provider: 'ollama' },
      ollama: {
        baseUrl: 'http://127.0.0.1:11434',
        model: 'qwen3:8b',
      },
      webSearch: { apiKey: '' },
      security: {
        allowedChannelIds: new Set<string>(),
        maxInputChars: 100,
      },
      engagement: {
        enabled: overrides.engagementEnabled ?? true,
        channels: {
          introductionId: '',
          suggestionId: '',
          eventId: '',
          recapId: '',
          activityId: overrides.activityId,
          birthdayId: '',
          rssId: '',
        },
        rssAllowedHosts: [],
        recapSchedule: '',
        retentionDays: 30,
        adminRoleIds: overrides.adminRoleIds,
      },
    },
    conversationService: {
      ask: async () => ({ status: 'success', text: 'unused' }),
      clear: async () => 0,
    },
    store: {
      healthCheck: async () => true,
    },
    reminderService: {
      set: async () => {
        throw new Error('unused');
      },
      list: async () => [],
      cancel: async () => undefined,
    },
    reminderHealth: {
      store: {
        healthCheck: async () => true,
        statusCounts: async () => ({
          pending: 0,
          retryPending: 0,
          deliveryUncertain: 0,
          failed: 0,
        }),
      },
      scheduler: { healthy: true },
    },
    faq: {
      entries: [],
      get: () => undefined,
    },
    delegatedPostService: overrides.service,
  };
}

function postInteraction(
  overrides: Readonly<{
    guildId?: string | null;
    channelId?: string;
    roleIds?: readonly string[];
    subcommand?: 'preview' | 'confirm' | 'cancel';
    values?: Readonly<Record<string, string | null>>;
  }> = {},
): {
  readonly interaction: CommandInteraction;
  readonly replies: ReplyPayload[];
} {
  const replies: ReplyPayload[] = [];
  const values = overrides.values ?? {};
  return {
    replies,
    interaction: {
      id: 'interaction-1',
      commandName: 'post',
      guildId: overrides.guildId === undefined ? 'guild-1' : overrides.guildId,
      channelId: overrides.channelId ?? 'current-channel',
      channel: { parentId: null, isThread: () => false },
      user: { id: 'u', username: 'Jim' },
      member: {
        roles: {
          cache: {
            has: (id: string) =>
              (overrides.roleIds ?? ['admin-role']).includes(id),
          },
        },
      },
      options: {
        getSubcommand: () => overrides.subcommand ?? 'preview',
        getString: (name) => {
          if (name in values) return values[name] ?? null;
          return name === 'content' ? 'Hello crew' : null;
        },
      },
      deferReply: async () => undefined,
      fetchReply: async () => ({ id: 'message-1' }),
      reply: async (payload) => {
        replies.push(payload);
      },
      editReply: async () => undefined,
      followUp: async () => undefined,
    },
  };
}
