import { describe, expect, it } from 'vitest';
import { handleMemberProfileCommand } from '../src/commands/member-profile.js';
import type { MemberProfile } from '../src/engagement/member-profiles.js';

describe('/profile', () => {
  it('renders an owner-private create preview with confirm and cancel buttons', async () => {
    const interaction = command('create', {
      bio: 'Builder',
      interests: 'Games',
    });
    await handleMemberProfileCommand(interaction as any, {
      enabled: true,
      service: service({
        previewCreate: async () => draft('create'),
      }),
    });
    expect(interaction.replies).toEqual([
      expect.objectContaining({
        ephemeral: true,
        allowedMentions: { parse: [], repliedUser: false },
        components: [expect.objectContaining({ type: 1 })],
      }),
    ]);
    expect(JSON.stringify(interaction.replies[0])).toContain(
      'preview:v1:profile:draft-1:confirm',
    );
  });

  it('shows visible member profiles publicly using current Discord identity', async () => {
    const interaction = command('view', {}, target());
    await handleMemberProfileCommand(interaction as any, {
      enabled: true,
      service: service({ get: async () => profile() }),
    });
    expect(interaction.replies).toEqual([
      expect.objectContaining({ ephemeral: false }),
    ]);
    expect(JSON.stringify(interaction.replies[0])).toMatch(/Current Crew Name/);
    expect(JSON.stringify(interaction.replies[0])).toMatch(/Builder/);
    expect(JSON.stringify(interaction.replies[0])).toMatch(
      /https:\/\/cdn\.discordapp\.com\/avatar\.png/,
    );
  });

  it('uses one neutral private response for hidden and missing third-party profiles', async () => {
    for (const value of [undefined, profile({ visibility: 'hidden' })]) {
      const interaction = command('view', {}, target());
      await handleMemberProfileCommand(interaction as any, {
        enabled: true,
        service: service({ get: async () => value }),
      });
      expect(interaction.replies[0]).toEqual(
        expect.objectContaining({
          content: expect.stringMatching(/not available/i),
          ephemeral: true,
        }),
      );
    }
  });

  it('lets the owner privately view a hidden profile', async () => {
    const interaction = command('view');
    await handleMemberProfileCommand(interaction as any, {
      enabled: true,
      service: service({ get: async () => profile({ visibility: 'hidden' }) }),
    });
    expect(interaction.replies[0]).toEqual(
      expect.objectContaining({ ephemeral: true }),
    );
  });

  it('rejects bots and a disabled feature safely', async () => {
    const bot = command('view', {}, target({ bot: true }));
    await handleMemberProfileCommand(bot as any, {
      enabled: true,
      service: service(),
    });
    expect(bot.replies[0]?.content).toMatch(/not available/i);
    const disabled = command('create');
    await handleMemberProfileCommand(disabled as any, {
      enabled: false,
      service: service(),
    });
    expect(disabled.replies[0]?.content).toMatch(/disabled/i);
  });
});

const service = (overrides: Record<string, unknown> = {}) => ({
  previewCreate: async () => draft('create'),
  previewEdit: async () => draft('edit'),
  previewDelete: async () => draft('delete'),
  get: async () => undefined,
  hide: async () => true,
  show: async () => true,
  ...overrides,
});
const draft = (operation: 'create' | 'edit' | 'delete') => ({
  id: 'draft-1',
  serverId: 'ship-1',
  ownerUserId: 'owner-1',
  operation,
  bio: 'Builder',
  interests: 'Games',
  interestsSuggested: false,
  expiresAt: new Date('2026-08-10T12:15:00Z'),
});
const profile = (overrides: Partial<MemberProfile> = {}): MemberProfile => ({
  serverId: 'ship-1',
  userId: 'member-2',
  bio: 'Builder',
  interests: 'Games',
  visibility: 'visible',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});
const target = (overrides: Record<string, unknown> = {}) => ({
  id: 'member-2',
  bot: false,
  globalName: 'Current Crew Name',
  username: 'crew',
  displayAvatarURL: () => 'https://cdn.discordapp.com/avatar.png',
  ...overrides,
});
function command(
  subcommand: string,
  strings: Record<string, string> = {},
  member?: unknown,
) {
  const replies: any[] = [];
  return {
    guildId: 'ship-1',
    user: target({ id: 'owner-1', globalName: 'Owner' }),
    member: {
      displayName: 'Owner Display',
      joinedAt: new Date('2026-01-01T00:00:00Z'),
    },
    options: {
      getSubcommand: () => subcommand,
      getString: (name: string) => strings[name] ?? null,
      getUser: () => member ?? null,
    },
    replies,
    reply: async (payload: any) => void replies.push(payload),
  };
}
