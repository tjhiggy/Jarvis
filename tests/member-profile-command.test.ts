import { describe, expect, it } from 'vitest';
import { handleMemberProfileCommand } from '../src/commands/member-profile.js';
import {
  MemberProfileServiceError,
  type MemberProfile,
} from '../src/engagement/member-profiles.js';

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
    const interaction = command('view', {}, target(), {
      displayName: 'Server Crew Nickname',
      joinedAt: new Date('2025-07-04T12:00:00Z'),
    });
    await handleMemberProfileCommand(interaction as any, {
      enabled: true,
      service: service({ get: async () => profile() }),
    });
    expect(interaction.replies).toEqual([
      expect.objectContaining({ ephemeral: false }),
    ]);
    expect(JSON.stringify(interaction.replies[0])).toMatch(
      /Server Crew Nickname/,
    );
    expect(JSON.stringify(interaction.replies[0])).toMatch(/7\/4\/2025/);
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

  it('stays private in a DM and does not call the profile service', async () => {
    const calls: string[] = [];
    const interaction = command('hide');
    interaction.guildId = null;
    await handleMemberProfileCommand(interaction as any, {
      enabled: true,
      service: service({
        hide: async () => {
          calls.push('hide');
          return true;
        },
      }),
    });
    expect(calls).toEqual([]);
    expect(interaction.replies[0]).toEqual(
      expect.objectContaining({
        content: 'This command is available only in a server channel.',
        ephemeral: true,
        allowedMentions: { parse: [], repliedUser: false },
      }),
    );
  });

  it('hides and shows an owner profile, or reports a private miss', async () => {
    const hidden = command('hide');
    await handleMemberProfileCommand(hidden as any, {
      enabled: true,
      service: service({ hide: async () => true }),
    });
    expect(hidden.replies[0]).toEqual(
      expect.objectContaining({
        content: 'Your member profile is now hidden.',
        ephemeral: true,
      }),
    );

    const visible = command('show');
    await handleMemberProfileCommand(visible as any, {
      enabled: true,
      service: service({ show: async () => true }),
    });
    expect(visible.replies[0]?.content).toBe(
      'Your member profile is now visible.',
    );

    const missing = command('hide');
    await handleMemberProfileCommand(missing as any, {
      enabled: true,
      service: service({ hide: async () => false }),
    });
    expect(missing.replies[0]?.content).toBe(
      'Your member profile was not found.',
    );
  });

  it('maps mention-bearing and duplicate profile input without leaking the raw text', async () => {
    const mention = command('create', { bio: '@everyone report aboard' });
    await handleMemberProfileCommand(mention as any, {
      enabled: true,
      service: service({
        previewCreate: async () => {
          throw new MemberProfileServiceError('invalid-input');
        },
      }),
    });
    expect(mention.replies[0]).toEqual(
      expect.objectContaining({
        content:
          'Use a bio of up to 500 characters and interests of up to 300 characters without mass or role mentions.',
        ephemeral: true,
      }),
    );
    expect(mention.replies[0]?.content).not.toMatch(/@everyone|report aboard/);

    const duplicate = command('create', { bio: 'Builder' });
    await handleMemberProfileCommand(duplicate as any, {
      enabled: true,
      service: service({
        previewCreate: async () => {
          throw new MemberProfileServiceError('duplicate');
        },
      }),
    });
    expect(duplicate.replies[0]?.content).toMatch(
      /already have a member profile/i,
    );

    const deletion = command('delete');
    await handleMemberProfileCommand(deletion as any, {
      enabled: true,
      service: service({
        previewDelete: async () => draft('delete'),
      }),
    });
    expect(JSON.stringify(deletion.replies[0])).toContain(
      'preview:v1:profile:draft-1:confirm',
    );
    expect(JSON.stringify(deletion.replies[0])).toMatch(/permanently removes/i);
    expect(deletion.replies[0]).toEqual(
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
  serverMember?: unknown,
) {
  const replies: any[] = [];
  return {
    guildId: 'ship-1' as string | null,
    user: target({ id: 'owner-1', globalName: 'Owner' }),
    member: {
      displayName: 'Owner Display',
      joinedAt: new Date('2026-01-01T00:00:00Z'),
    },
    options: {
      getSubcommand: () => subcommand,
      getString: (name: string) => strings[name] ?? null,
      getUser: () => member ?? null,
      getMember: () => serverMember ?? null,
    },
    replies,
    reply: async (payload: any) => void replies.push(payload),
  };
}
