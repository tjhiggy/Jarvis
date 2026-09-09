import { describe, expect, it, vi } from 'vitest';
import { createCommandDefinitions } from '../src/commands/definitions.js';
import { handleGameNightCommand } from '../src/commands/game-night.js';
import type { EventService } from '../src/engagement/events.js';
import {
  handleCommand,
  type CommandDependencies,
  type CommandInteraction,
  type ReplyPayload,
} from '../src/commands/handlers.js';

const safeMentions = { parse: [], repliedUser: false };
const faqEntry = {
  id: 'capabilities',
  label: 'Capabilities',
  question: 'What can Jarvis do?',
  answer: 'Synthetic answer.',
};

describe('game night command', () => {
  it('registers administrator create options and a public list subcommand', () => {
    const command = createCommandDefinitions(2_000, [faqEntry]).find(
      (definition) => definition.name === 'game-night',
    );

    expect(command).toMatchObject({
      type: 1,
      name: 'game-night',
      description: expect.stringMatching(/game night/i),
    });
    expect(command).toMatchObject({
      options: [
        {
          type: 1,
          name: 'create',
          description: expect.stringMatching(/administrator/i),
          options: [
            {
              type: 3,
              name: 'game',
              description: expect.stringMatching(/game/i),
              required: true,
              max_length: 120,
            },
            {
              type: 3,
              name: 'start',
              description: expect.stringMatching(/YYYY-MM-DD/i),
              required: true,
              max_length: 16,
            },
            {
              type: 3,
              name: 'details',
              description: expect.stringMatching(/details/i),
              required: false,
              max_length: 1000,
            },
            {
              type: 3,
              name: 'timezone',
              description: expect.stringMatching(/timezone/i),
              required: false,
              max_length: 100,
            },
            {
              type: 3,
              name: 'capacity',
              description: expect.stringMatching(/seat/i),
              required: false,
              max_length: 4,
            },
          ],
        },
        { type: 1, name: 'list', description: expect.stringMatching(/list/i) },
      ],
    });
  });

  it('schedules a low-friction game night with defaults', async () => {
    let input: any;
    const interaction: any = {
      guildId: 'g',
      user: { id: 'u' },
      member: { roles: { cache: { has: (id: string) => id === 'admin' } } },
      options: {
        getSubcommand: () => 'create',
        getString: (name: string) =>
          (({ game: 'Fortnite', start: '2026-08-10 20:00' }) as any)[name] ??
          null,
      },
      reply: async (value: any) => {
        interaction.replyValue = value;
      },
    };
    await handleGameNightCommand(interaction, {
      enabled: true,
      channelId: 'events',
      adminRoleIds: new Set(['admin']),
      service: {
        create: async (value: any) => {
          input = value;
          return { id: 'gn-1' };
        },
      } as any,
    });
    expect(input).toMatchObject({
      title: 'Game Night: Fortnite',
      timezone: 'America/New_York',
      capacity: 20,
    });
    expect(interaction.replyValue).toMatchObject({
      content: expect.stringContaining('Game night gn-1 is scheduled'),
      ephemeral: true,
      allowedMentions: safeMentions,
    });
  });

  it.each([null, '', '   '])(
    'stays ephemeral in DMs or with a blank guild id (%j)',
    async (guildId) => {
      const { interaction, replies, create } = gameNightInteraction({
        guildId,
        subcommand: 'create',
        roleIds: ['admin'],
        values: { game: 'Fortnite', start: '2026-08-10 20:00' },
      });
      await handleGameNightCommand(interaction, configured(create));
      expect(create).not.toHaveBeenCalled();
      expect(replies).toEqual([
        {
          content: 'This command is available only in a MuthaShip server.',
          ephemeral: true,
          allowedMentions: safeMentions,
        },
      ]);
    },
  );

  it.each([
    { enabled: false, channelId: 'events', withService: true },
    { enabled: true, channelId: '   ', withService: true },
    { enabled: true, channelId: 'events', withService: false },
  ])(
    'stays ephemeral when game nights are not configured',
    async ({ enabled, channelId, withService }) => {
      const { interaction, replies, create } = gameNightInteraction({
        subcommand: 'list',
      });
      await handleGameNightCommand(interaction, {
        enabled,
        channelId,
        adminRoleIds: new Set(['admin']),
        ...(withService ? { service: { list: create, create } as any } : {}),
      });
      expect(create).not.toHaveBeenCalled();
      expect(replies).toEqual([
        {
          content: 'Game nights are not configured on the MuthaShip.',
          ephemeral: true,
          allowedMentions: safeMentions,
        },
      ]);
    },
  );

  it('lets any member list game nights and omits non-game-night events', async () => {
    const list = vi.fn(async () => [
      {
        id: 'gn-1',
        title: 'Game Night: Fortnite',
        scheduledAt: new Date('2026-08-10T20:00:00.000Z'),
      },
      {
        id: 'evt-9',
        title: 'Crew meeting',
        scheduledAt: new Date('2026-08-11T20:00:00.000Z'),
      },
    ]);
    const { interaction, replies } = gameNightInteraction({
      subcommand: 'list',
      roleIds: [],
    });
    await handleGameNightCommand(interaction, {
      enabled: true,
      channelId: 'events',
      adminRoleIds: new Set(['admin']),
      service: { list } as any,
    });
    expect(list).toHaveBeenCalledWith('g');
    expect(replies).toEqual([
      {
        content: 'gn-1: Game Night: Fortnite at 2026-08-10T20:00:00.000Z',
        ephemeral: true,
        allowedMentions: safeMentions,
      },
    ]);
  });

  it('reports an empty list when no game nights are scheduled', async () => {
    const { interaction, replies } = gameNightInteraction({
      subcommand: 'list',
    });
    await handleGameNightCommand(interaction, {
      enabled: true,
      channelId: 'events',
      adminRoleIds: new Set(['admin']),
      service: { list: async () => [] } as any,
    });
    expect(replies).toEqual([
      {
        content: 'No game nights are scheduled.',
        ephemeral: true,
        allowedMentions: safeMentions,
      },
    ]);
  });

  it('blocks non-administrators from scheduling without calling create', async () => {
    const { interaction, replies, create } = gameNightInteraction({
      subcommand: 'create',
      roleIds: ['member'],
      values: { game: 'Fortnite', start: '2026-08-10 20:00' },
    });
    await handleGameNightCommand(interaction, {
      enabled: true,
      channelId: 'events',
      adminRoleIds: new Set(['admin']),
      service: { create } as any,
    });
    expect(create).not.toHaveBeenCalled();
    expect(replies).toEqual([
      {
        content:
          'Only configured MuthaShip administrators can schedule game nights.',
        ephemeral: true,
        allowedMentions: safeMentions,
      },
    ]);
  });

  it('keeps create failures ephemeral and does not leak service errors', async () => {
    const { interaction, replies } = gameNightInteraction({
      subcommand: 'create',
      roleIds: ['admin'],
      values: { game: 'Fortnite', start: 'yesterday' },
    });
    await handleGameNightCommand(interaction, {
      enabled: true,
      channelId: 'events',
      adminRoleIds: new Set(['admin']),
      service: {
        create: async () => {
          throw new Error('secret start payload and stack');
        },
      } as any,
    });
    expect(replies).toEqual([
      {
        content:
          'The game night could not be scheduled. Check the game name and future start time, then retry.',
        ephemeral: true,
        allowedMentions: safeMentions,
      },
    ]);
    expect(JSON.stringify(replies)).not.toMatch(/secret start payload/i);
  });

  it('routes /game-night list through handleCommand', async () => {
    const list = vi.fn(async () => []);
    const fake = commandInteraction({
      commandName: 'game-night',
      subcommand: 'list',
    });
    await handleCommand(
      fake.interaction,
      commandDependencies({
        eventService: { list } as any,
      }),
    );
    expect(list).toHaveBeenCalledWith('guild-1');
    expect(fake.replies).toEqual([
      {
        content: 'No game nights are scheduled.',
        ephemeral: true,
        allowedMentions: safeMentions,
      },
    ]);
  });
});

function gameNightInteraction(
  overrides: Readonly<{
    guildId?: string | null;
    subcommand?: string;
    roleIds?: readonly string[];
    values?: Readonly<Record<string, string | null>>;
  }> = {},
): {
  readonly interaction: any;
  readonly replies: ReplyPayload[];
  readonly create: ReturnType<typeof vi.fn>;
} {
  const replies: ReplyPayload[] = [];
  const values = overrides.values ?? {};
  const create = vi.fn();
  return {
    replies,
    create,
    interaction: {
      guildId: overrides.guildId === undefined ? 'g' : overrides.guildId,
      user: { id: 'u' },
      member: {
        roles: {
          cache: {
            has: (id: string) => (overrides.roleIds ?? ['admin']).includes(id),
          },
        },
      },
      options: {
        getSubcommand: () => overrides.subcommand ?? 'create',
        getString: (name: string) => values[name] ?? null,
      },
      reply: async (payload: ReplyPayload) => {
        replies.push(payload);
      },
    },
  };
}

function configured(create: ReturnType<typeof vi.fn>) {
  return {
    enabled: true,
    channelId: 'events',
    adminRoleIds: new Set(['admin']),
    service: { create } as any,
  };
}

function commandInteraction(
  overrides: Readonly<{
    commandName?: string;
    subcommand?: string;
    roleIds?: readonly string[];
  }> = {},
): {
  readonly interaction: CommandInteraction;
  readonly replies: ReplyPayload[];
} {
  const replies: ReplyPayload[] = [];
  return {
    replies,
    interaction: {
      id: 'interaction-1',
      commandName: overrides.commandName ?? 'game-night',
      guildId: 'guild-1',
      channelId: 'channel-1',
      channel: { parentId: null, isThread: () => false },
      user: { id: 'user-1' },
      member: {
        roles: {
          cache: {
            has: (id: string) => (overrides.roleIds ?? []).includes(id),
          },
        },
      },
      options: {
        getSubcommand: () => overrides.subcommand ?? 'list',
        getString: () => null,
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

function commandDependencies(
  overrides: Readonly<{ eventService: unknown }>,
): CommandDependencies {
  return {
    config: {
      discord: {
        token: 'discord-token',
        clientId: 'client-1',
        guildId: 'guild-1',
      },
      openai: { apiKey: 'openai-key' },
      ai: { provider: 'ollama' },
      ollama: {
        baseUrl: 'http://127.0.0.1:11434',
        model: 'qwen3:8b',
      },
      webSearch: { apiKey: 'tvly-secret' },
      security: {
        allowedChannelIds: new Set<string>(),
        maxInputChars: 100,
      },
      engagement: {
        enabled: true,
        channels: {
          introductionId: '',
          suggestionId: '',
          eventId: 'events',
          recapId: '',
          activityId: '',
          birthdayId: '',
          rssId: '',
        },
        rssAllowedHosts: [],
        recapSchedule: '',
        retentionDays: 30,
        adminRoleIds: new Set(['admin']),
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
    eventService: overrides.eventService as EventService,
  };
}
