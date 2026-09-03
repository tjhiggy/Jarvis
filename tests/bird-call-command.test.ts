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

  it('neutralizes mentions in the optional game text and keeps allowedMentions empty', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const game =
      'raid with @everyone @here <@123456789012345678> <@!123456789012345678> <@&987654321098765432> in <#111222333444555666>';
    await handleBirdCallCommand(
      interaction({
        guildId: 'guild-1',
        game,
        reply,
      }),
    );

    const content = reply.mock.calls[0]?.[0]?.content as string;
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        ephemeral: false,
        allowedMentions: safeMentions,
      }),
    );
    expect(content).not.toContain('@everyone');
    expect(content).not.toContain('@here');
    expect(content).not.toContain('<@123456789012345678>');
    expect(content).not.toContain('<@!123456789012345678>');
    expect(content).not.toContain('<@&987654321098765432>');
    expect(content).not.toContain('<#111222333444555666>');
    expect(content).toContain('@\u200beveryone');
    expect(content).toContain('@\u200bhere');
    expect(content).toContain('<@\u200b123456789012345678>');
    expect(content).toContain('<@\u200b!123456789012345678>');
    expect(content).toContain('<@\u200b&987654321098765432>');
    expect(content).toContain('<#\u200b111222333444555666>');
  });

  it('fails closed for a whitespace-only guild id without posting a public bird call', async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await handleBirdCallCommand(
      interaction({
        guildId: '   ',
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
