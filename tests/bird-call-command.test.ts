import { describe, expect, it, vi } from 'vitest';
import { createCommandDefinitions } from '../src/commands/definitions.js';
import {
  formatBirdCallMessage,
  handleBirdCallCommand,
} from '../src/commands/bird-call.js';

const safeMentions = { parse: [], repliedUser: false };

describe('/bird-call', () => {
  it('registers an optional game option with a 120-character bound', () => {
    const command = createCommandDefinitions(2_000, [
      {
        id: 'capabilities',
        label: 'Capabilities',
        question: 'What can Jarvis do?',
        answer: 'Synthetic answer.',
      },
    ]).find((definition) => definition.name === 'bird-call');

    expect(command).toMatchObject({
      type: 1,
      name: 'bird-call',
      description: expect.stringMatching(/game now/i),
    });
    expect(command?.options).toEqual([
      {
        type: 3,
        name: 'game',
        description: expect.stringMatching(/optional/i),
        required: false,
        max_length: 120,
      },
    ]);
  });

  it('posts one public MuthaShip-voice invite with empty allowedMentions', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleBirdCallCommand(
      interaction({
        guildId: 'guild-1',
        game: null,
        reply,
      }),
    );

    expect(reply).toHaveBeenCalledWith({
      content: formatBirdCallMessage(),
      ephemeral: false,
      allowedMentions: safeMentions,
    });
    expect(reply.mock.calls[0]?.[0]?.content).toMatch(/bird call/i);
    expect(reply.mock.calls[0]?.[0]?.content).toMatch(/game now/i);
    expect(reply.mock.calls[0]?.[0]?.content).not.toMatch(/@everyone|@here|<@/);
  });

  it('names the optional game in that same public line', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleBirdCallCommand(
      interaction({
        guildId: 'guild-1',
        game: 'Helldivers 2',
        reply,
      }),
    );

    expect(reply).toHaveBeenCalledWith({
      content: formatBirdCallMessage('Helldivers 2'),
      ephemeral: false,
      allowedMentions: safeMentions,
    });
    expect(reply.mock.calls[0]?.[0]?.content).toContain('Helldivers 2');
  });

  it('treats blank game text as the default invite', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleBirdCallCommand(
      interaction({
        guildId: 'guild-1',
        game: '   ',
        reply,
      }),
    );

    expect(reply).toHaveBeenCalledWith({
      content: formatBirdCallMessage(),
      ephemeral: false,
      allowedMentions: safeMentions,
    });
  });

  it('keeps role mentions in game text and allows exactly those roles', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const consultant = '1147945394039435316';
    const advisor = '1005112363369889794';
    const game = `<@&${consultant}> <@&${advisor}>`;
    await handleBirdCallCommand(
      interaction({
        guildId: 'guild-1',
        game,
        reply,
      }),
    );

    expect(reply).toHaveBeenCalledWith({
      content: `Bird call. Who on the MuthaShip wants to play <@&${consultant}> <@&${advisor}> now?`,
      ephemeral: false,
      allowedMentions: {
        parse: [],
        repliedUser: false,
        roles: [consultant, advisor],
      },
    });
  });

  it('neutralizes mass, user, and channel mentions without allowing them', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const game =
      'raid with @everyone @here <@123456789012345678> <@!234567890123456789> <#345678901234567890>';
    await handleBirdCallCommand(
      interaction({
        guildId: 'guild-1',
        game,
        reply,
      }),
    );

    const payload = reply.mock.calls[0]?.[0] as {
      content: string;
      allowedMentions: Record<string, unknown>;
    };
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        ephemeral: false,
        allowedMentions: safeMentions,
      }),
    );
    expect(payload.allowedMentions).not.toHaveProperty('roles');
    expect(payload.allowedMentions).not.toHaveProperty('users');
    expect(payload.allowedMentions.parse).toEqual([]);
    expect(payload.content).not.toContain('@everyone');
    expect(payload.content).not.toContain('@here');
    expect(payload.content).not.toContain('<@123456789012345678>');
    expect(payload.content).not.toContain('<@!234567890123456789>');
    expect(payload.content).not.toContain('<#345678901234567890>');
    expect(payload.content).toContain('@\u200beveryone');
    expect(payload.content).toContain('@\u200bhere');
    expect(payload.content).toContain('<@\u200b123456789012345678>');
    expect(payload.content).toContain('<@\u200b!234567890123456789>');
    expect(payload.content).toContain('<#\u200b345678901234567890>');
  });

  it('keeps role tokens when mixed with blocked mention types', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const roleId = '987654321098765432';
    const game = `raid with @everyone <@123456789012345678> and <@&${roleId}>`;
    await handleBirdCallCommand(
      interaction({
        guildId: 'guild-1',
        game,
        reply,
      }),
    );

    const payload = reply.mock.calls[0]?.[0] as {
      content: string;
      allowedMentions: { roles?: readonly string[] };
    };
    expect(payload.content).toContain(`<@&${roleId}>`);
    expect(payload.content).not.toContain('<@\u200b&');
    expect(payload.content).toContain('@\u200beveryone');
    expect(payload.content).toContain('<@\u200b123456789012345678>');
    expect(payload.allowedMentions).toEqual({
      parse: [],
      repliedUser: false,
      roles: [roleId],
    });
  });

  it('fails closed in DMs without posting a public bird call', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleBirdCallCommand(
      interaction({
        guildId: null,
        game: 'Fortnite',
        reply,
      }),
    );

    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/server channel/i),
        ephemeral: true,
        allowedMentions: safeMentions,
      }),
    );
    expect(reply.mock.calls[0]?.[0]?.content).not.toMatch(/bird call/i);
    expect(reply.mock.calls[0]?.[0]?.content).not.toContain('Fortnite');
  });

  it('fails closed in DMs even when game text contains role mentions', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const roleId = '1147945394039435316';
    await handleBirdCallCommand(
      interaction({
        guildId: null,
        game: `<@&${roleId}>`,
        reply,
      }),
    );

    const payload = reply.mock.calls[0]?.[0] as {
      content: string;
      allowedMentions: Record<string, unknown>;
    };
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringMatching(/server channel/i),
        ephemeral: true,
        allowedMentions: safeMentions,
      }),
    );
    expect(payload.allowedMentions).not.toHaveProperty('roles');
    expect(payload.allowedMentions).not.toHaveProperty('users');
    expect(payload.content).not.toMatch(/bird call/i);
    expect(payload.content).not.toContain(`<@&${roleId}>`);
  });

  it('deduplicates repeated role IDs in allowedMentions', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const roleId = '1147945394039435316';
    await handleBirdCallCommand(
      interaction({
        guildId: 'guild-1',
        game: `<@&${roleId}> again <@&${roleId}>`,
        reply,
      }),
    );

    const payload = reply.mock.calls[0]?.[0] as {
      content: string;
      allowedMentions: { roles?: readonly string[] };
    };
    expect(payload.content).toContain(`<@&${roleId}> again <@&${roleId}>`);
    expect(payload.allowedMentions).toEqual({
      parse: [],
      repliedUser: false,
      roles: [roleId],
    });
  });

  it('does not ping @everyone via the guild-id role token', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const guildId = '123456789012345678';
    const gameRole = '987654321098765432';
    await handleBirdCallCommand(
      interaction({
        guildId,
        game: `<@&${guildId}> with <@&${gameRole}>`,
        reply,
      }),
    );

    const payload = reply.mock.calls[0]?.[0] as {
      content: string;
      allowedMentions: { parse?: readonly string[]; roles?: readonly string[] };
    };
    expect(payload.content).not.toContain(`<@&${guildId}>`);
    expect(payload.content).toContain(`<@&\u200b${guildId}>`);
    expect(payload.content).toContain(`<@&${gameRole}>`);
    expect(payload.allowedMentions).toEqual({
      parse: [],
      repliedUser: false,
      roles: [gameRole],
    });
    expect(payload.allowedMentions.roles).not.toContain(guildId);
  });

  it('keeps empty allowedMentions when game is only the @everyone role', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const guildId = '123456789012345678';
    await handleBirdCallCommand(
      interaction({
        guildId,
        game: `<@&${guildId}>`,
        reply,
      }),
    );

    const payload = reply.mock.calls[0]?.[0] as {
      content: string;
      allowedMentions: Record<string, unknown>;
    };
    expect(payload.content).not.toContain(`<@&${guildId}>`);
    expect(payload.content).toContain(`<@&\u200b${guildId}>`);
    expect(payload.allowedMentions).toEqual(safeMentions);
    expect(payload.allowedMentions).not.toHaveProperty('roles');
  });

  it('does not allow malformed role-like tokens', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleBirdCallCommand(
      interaction({
        guildId: 'guild-1',
        game: '<@&> <@&abc> <@&123 play',
        reply,
      }),
    );

    const payload = reply.mock.calls[0]?.[0] as {
      allowedMentions: Record<string, unknown>;
    };
    expect(payload.allowedMentions).toEqual(safeMentions);
    expect(payload.allowedMentions).not.toHaveProperty('roles');
  });

  it('keeps a role token adjacent to a neutralized user mention', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const roleId = '987654321098765432';
    const userId = '123456789012345678';
    await handleBirdCallCommand(
      interaction({
        guildId: 'guild-1',
        game: `<@${userId}><@&${roleId}>`,
        reply,
      }),
    );

    const payload = reply.mock.calls[0]?.[0] as {
      content: string;
      allowedMentions: Record<string, unknown>;
    };
    expect(payload.content).toContain(`<@\u200b${userId}><@&${roleId}>`);
    expect(payload.content).not.toContain(`<@${userId}>`);
    expect(payload.allowedMentions).toEqual({
      parse: [],
      repliedUser: false,
      roles: [roleId],
    });
    expect(payload.allowedMentions).not.toHaveProperty('users');
  });

  it('neutralizes case-insensitive mass mentions while keeping a role', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const roleId = '1005112363369889794';
    await handleBirdCallCommand(
      interaction({
        guildId: 'guild-1',
        game: `@EVERYONE @HERE <@&${roleId}>`,
        reply,
      }),
    );

    const payload = reply.mock.calls[0]?.[0] as {
      content: string;
      allowedMentions: { parse?: readonly string[]; roles?: readonly string[] };
    };
    expect(payload.content).toContain('@\u200bEVERYONE');
    expect(payload.content).toContain('@\u200bHERE');
    expect(payload.content).not.toContain('@EVERYONE');
    expect(payload.content).not.toContain('@HERE');
    expect(payload.content).toContain(`<@&${roleId}>`);
    expect(payload.allowedMentions).toEqual({
      parse: [],
      repliedUser: false,
      roles: [roleId],
    });
  });
});

function interaction(input: {
  guildId: string | null;
  game: string | null;
  reply: (payload: unknown) => Promise<unknown>;
}) {
  return {
    guildId: input.guildId,
    options: {
      getString: (name: string) => (name === 'game' ? input.game : null),
    },
    reply: input.reply,
  };
}
