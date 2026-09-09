import { describe, expect, it } from 'vitest';
import { createCommandDefinitions } from '../src/commands/definitions.js';
import {
  handleCommand,
  type CommandDependencies,
  type CommandInteraction,
  type ReplyPayload,
} from '../src/commands/handlers.js';
import { handleLookingForGroupCommand } from '../src/commands/looking-for-group.js';

const safeMentions = { parse: [], repliedUser: false };
const faqEntry = {
  id: 'capabilities',
  label: 'Capabilities',
  question: 'What can Jarvis do?',
  answer: 'Synthetic answer.',
};

const interaction = (
  values: Record<string, string | null>,
  overrides: Readonly<{
    guildId?: string | null;
    globalName?: string | null;
    username?: string;
  }> = {},
): {
  readonly guildId: string | null;
  readonly user: Readonly<{
    id: string;
    globalName?: string | null;
    username?: string;
  }>;
  readonly options: Readonly<{ getString(name: string): string | null }>;
  readonly replies: ReplyPayload[];
  reply(payload: ReplyPayload): Promise<void>;
} => {
  const replies: ReplyPayload[] = [];
  return {
    guildId: overrides.guildId === undefined ? 'ship' : overrides.guildId,
    user: {
      id: 'u1',
      globalName:
        overrides.globalName === undefined
          ? 'UselessBoi'
          : overrides.globalName,
      username: overrides.username ?? 'fallback-user',
    },
    options: { getString: (name: string) => values[name] ?? null },
    replies,
    reply: async (payload) => {
      replies.push(payload);
    },
  };
};

describe('looking for group command', () => {
  it('registers required game and bounded optional when/details options', () => {
    const command = createCommandDefinitions(2_000, [faqEntry]).find(
      (definition) => definition.name === 'lfg',
    );

    expect(command).toMatchObject({
      type: 1,
      name: 'lfg',
      description: expect.stringMatching(/looking for a group/i),
    });
    expect(command?.options).toEqual([
      {
        type: 3,
        name: 'game',
        description: expect.stringMatching(/game/i),
        required: true,
        max_length: 120,
      },
      {
        type: 3,
        name: 'when',
        description: expect.stringMatching(/time|availability/i),
        required: false,
        max_length: 120,
      },
      {
        type: 3,
        name: 'details',
        description: expect.stringMatching(/details/i),
        required: false,
        max_length: 500,
      },
    ]);
  });

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
    expect(value.replies[0]).toMatchObject({
      content: expect.stringContaining('UselessBoi is looking for a group'),
      ephemeral: false,
      allowedMentions: safeMentions,
    });
    expect(value.replies[0]?.content).toContain('Game: Fortnite');
    expect(value.replies[0]?.content).toContain('When: tonight');
    expect(value.replies[0]?.content).toContain('Details: Zero Build');
  });

  it('falls back to username then a generic crew label', async () => {
    const usernameOnly = interaction(
      { game: 'Arc Raiders' },
      { globalName: '  ', username: 'ArcPilot' },
    );
    await handleLookingForGroupCommand(usernameOnly, {
      enabled: true,
      channelId: 'activity',
    });
    expect(usernameOnly.replies[0]?.content).toContain(
      'ArcPilot is looking for a group',
    );

    const anonymous = interaction(
      { game: 'Arc Raiders' },
      { globalName: null, username: '   ' },
    );
    await handleLookingForGroupCommand(anonymous, {
      enabled: true,
      channelId: 'activity',
    });
    expect(anonymous.replies[0]?.content).toContain(
      'Crew member is looking for a group',
    );
  });

  it('rejects empty game names without posting a public signal', async () => {
    const value = interaction({ game: '  ' });
    await handleLookingForGroupCommand(value, {
      enabled: true,
      channelId: 'activity',
    });
    expect(value.replies).toEqual([
      {
        content: expect.stringContaining('which game'),
        ephemeral: true,
        allowedMentions: safeMentions,
      },
    ]);
  });

  it.each([null, '', '   '])(
    'stays ephemeral in DMs or with a blank guild id (%j)',
    async (guildId) => {
      const value = interaction({ game: 'Fortnite' }, { guildId });
      await handleLookingForGroupCommand(value, {
        enabled: true,
        channelId: 'activity',
      });
      expect(value.replies).toEqual([
        {
          content: 'This command is available only on the MuthaShip.',
          ephemeral: true,
          allowedMentions: safeMentions,
        },
      ]);
    },
  );

  it.each([
    { enabled: false, channelId: 'activity' },
    { enabled: true, channelId: '   ' },
  ])(
    'stays ephemeral when matchmaking is not configured',
    async (dependencies) => {
      const value = interaction({ game: 'Fortnite' });
      await handleLookingForGroupCommand(value, dependencies);
      expect(value.replies).toEqual([
        {
          content: 'Crew matchmaking is not configured on the MuthaShip.',
          ephemeral: true,
          allowedMentions: safeMentions,
        },
      ]);
    },
  );

  it('neutralizes mention tokens in public game, details, when, and display name', async () => {
    const value = interaction(
      {
        game: '@everyone Fortnite <@&111>',
        when: '@here tonight <#222>',
        details: 'ping <@333> and <@!444>',
      },
      { globalName: '@everyone' },
    );
    await handleLookingForGroupCommand(value, {
      enabled: true,
      channelId: 'activity',
    });
    const payload = value.replies[0];
    expect(payload).toMatchObject({
      ephemeral: false,
      allowedMentions: safeMentions,
    });
    expect(payload?.content).toContain('@\u200beveryone');
    expect(payload?.content).toContain('<@\u200b&111>');
    expect(payload?.content).toContain('@\u200bhere');
    expect(payload?.content).toContain('<#\u200b222>');
    expect(payload?.content).toContain('<@\u200b333>');
    expect(payload?.content).toContain('<@\u200b!444>');
    expect(payload?.content).not.toMatch(/@everyone|@here|<@\d|<@&\d|<#\d/);
  });

  it('routes /lfg through handleCommand onto the activity channel config', async () => {
    const fake = commandInteraction({
      commandName: 'lfg',
      values: { game: 'Helldivers 2' },
    });
    await handleCommand(
      fake.interaction,
      commandDependencies({
        enabled: true,
        activityId: 'activity-channel',
      }),
    );
    expect(fake.replies).toEqual([
      expect.objectContaining({
        content: expect.stringContaining('Helldivers 2'),
        ephemeral: false,
        allowedMentions: safeMentions,
      }),
    ]);
  });

  it('routes unconfigured /lfg as an ephemeral miss', async () => {
    const fake = commandInteraction({
      commandName: 'lfg',
      values: { game: 'Helldivers 2' },
    });
    await handleCommand(
      fake.interaction,
      commandDependencies({ enabled: false, activityId: '' }),
    );
    expect(fake.replies).toEqual([
      {
        content: 'Crew matchmaking is not configured on the MuthaShip.',
        ephemeral: true,
        allowedMentions: safeMentions,
      },
    ]);
  });
});

function commandInteraction(
  overrides: Readonly<{
    commandName?: string;
    guildId?: string | null;
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
      commandName: overrides.commandName ?? 'lfg',
      guildId: overrides.guildId === undefined ? 'guild-1' : overrides.guildId,
      channelId: 'channel-1',
      channel: { parentId: null, isThread: () => false },
      user: { id: 'user-1', globalName: 'Jim', username: 'jim' },
      member: { roles: { cache: { has: () => false } } },
      options: {
        getSubcommand: () => 'unused',
        getString: (name) => values[name] ?? null,
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
  overrides: Readonly<{ enabled: boolean; activityId: string }>,
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
        enabled: overrides.enabled,
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
        adminRoleIds: new Set(),
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
  };
}
