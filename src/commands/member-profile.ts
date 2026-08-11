import { replySafely, type ReplyTarget } from '../discord/delivery.js';
import {
  buildEngagementButton,
  buildEngagementCard,
  toDiscordEngagementCard,
} from '../engagement/discord-ui.js';
import {
  MemberProfileServiceError,
  type MemberProfile,
  type MemberProfileDraft,
  type MemberProfileService,
} from '../engagement/member-profiles.js';

interface DiscordUser {
  readonly id: string;
  readonly bot?: boolean;
  readonly globalName?: string | null;
  readonly username?: string;
  displayAvatarURL?(): string;
}

export interface MemberProfileCommandInteraction extends ReplyTarget {
  readonly guildId: string | null;
  readonly user: DiscordUser;
  readonly member?: Readonly<{
    displayName?: string | null;
    joinedAt?: Date | null;
  }> | null;
  readonly options: Readonly<{
    getSubcommand(): string;
    getString(name: string): string | null;
    getUser?(name: string): DiscordUser | null;
  }>;
}

export const handleMemberProfileCommand = async (
  interaction: MemberProfileCommandInteraction,
  dependencies: Readonly<{
    enabled: boolean;
    service?: Pick<
      MemberProfileService,
      | 'previewCreate'
      | 'previewEdit'
      | 'previewDelete'
      | 'get'
      | 'hide'
      | 'show'
    >;
  }>,
): Promise<void> => {
  if (!interaction.guildId?.trim())
    return replySafely(
      interaction,
      'This command is available only in a server channel.',
      true,
    );
  if (!dependencies.enabled || dependencies.service === undefined)
    return replySafely(
      interaction,
      'Member profiles are disabled on this MuthaShip.',
      true,
    );
  try {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'view') return view(interaction, dependencies.service);
    if (subcommand === 'hide' || subcommand === 'show') {
      const changed = await dependencies.service[subcommand](
        interaction.guildId,
        interaction.user.id,
      );
      return replySafely(
        interaction,
        changed
          ? `Your member profile is now ${subcommand === 'hide' ? 'hidden' : 'visible'}.`
          : 'Your member profile was not found.',
        true,
      );
    }
    const draft =
      subcommand === 'create'
        ? await dependencies.service.previewCreate({
            serverId: interaction.guildId,
            ownerUserId: interaction.user.id,
            bio: interaction.options.getString('bio') ?? '',
            interests: interaction.options.getString('interests') ?? '',
          })
        : subcommand === 'edit'
          ? await dependencies.service.previewEdit({
              serverId: interaction.guildId,
              ownerUserId: interaction.user.id,
              bio: interaction.options.getString('bio') ?? '',
              interests: interaction.options.getString('interests') ?? '',
            })
          : await dependencies.service.previewDelete(
              interaction.guildId,
              interaction.user.id,
            );
    await interaction.reply({ ...profileDraftCard(draft), ephemeral: true });
  } catch (error) {
    await replySafely(interaction, errorMessage(error), true);
  }
};

const view = async (
  interaction: MemberProfileCommandInteraction,
  service: Pick<MemberProfileService, 'get'>,
): Promise<void> => {
  const target = interaction.options.getUser?.('member') ?? interaction.user;
  const ownerView = target.id === interaction.user.id;
  if (target.bot) return replySafely(interaction, unavailable, true);
  const profile = await service.get(interaction.guildId!, target.id);
  if (profile === undefined || (!ownerView && profile.visibility === 'hidden'))
    return replySafely(interaction, unavailable, true);
  const name = ownerView
    ? interaction.member?.displayName ||
      interaction.user.globalName ||
      interaction.user.username ||
      'Crew Member'
    : target.globalName || target.username || 'Crew Member';
  const card = profileCard(
    profile,
    name,
    ownerView ? interaction.member?.joinedAt : undefined,
  );
  await interaction.reply({
    ...card,
    ephemeral: ownerView && profile.visibility === 'hidden',
  });
};

const unavailable = 'That member profile is not available on this MuthaShip.';

const profileCard = (
  profile: MemberProfile,
  name: string,
  joinedAt?: Date | null,
) =>
  toDiscordEngagementCard(
    buildEngagementCard({
      title: `Crew profile: ${name}`,
      description: profile.bio ?? 'No bio provided.',
      fields: [
        ...(profile.interests
          ? [{ name: 'Interests', value: profile.interests }]
          : []),
        ...(joinedAt
          ? [
              {
                name: 'Aboard since',
                value: joinedAt.toLocaleDateString('en-US'),
              },
            ]
          : []),
        ...(profile.visibility === 'hidden'
          ? [{ name: 'Visibility', value: 'Hidden' }]
          : []),
      ],
    }),
  );

const profileDraftCard = (draft: MemberProfileDraft) =>
  toDiscordEngagementCard(
    buildEngagementCard({
      title:
        draft.operation === 'delete'
          ? 'Delete your crew profile?'
          : 'Review your crew profile',
      description:
        draft.operation === 'delete'
          ? 'This permanently removes your stored profile content.'
          : (draft.bio ?? 'No bio provided.'),
      fields:
        draft.operation === 'delete'
          ? []
          : [
              ...(draft.interests
                ? [
                    {
                      name: draft.interestsSuggested
                        ? 'Suggested interests'
                        : 'Interests',
                      value: draft.interests,
                    },
                  ]
                : []),
            ],
      content: 'Nothing changes until you confirm. Confirm or cancel below.',
      components: [
        {
          type: 'actionRow',
          components: [
            buildEngagementButton({
              customId: `preview:v1:profile:${draft.id}:confirm`,
              label: 'Confirm',
              style: draft.operation === 'delete' ? 'danger' : 'success',
            }),
            buildEngagementButton({
              customId: `preview:v1:profile:${draft.id}:cancel`,
              label: 'Cancel',
              style: 'secondary',
            }),
          ],
        },
      ],
    }),
  );

const errorMessage = (error: unknown): string => {
  if (!(error instanceof MemberProfileServiceError))
    return 'The member profile request could not be completed. Please retry privately later.';
  switch (error.code) {
    case 'duplicate':
      return 'You already have a member profile. Use /profile edit, hide, or delete.';
    case 'not-found':
      return 'Your member profile was not found.';
    case 'draft-limit':
      return 'Too many private profile previews are open. Cancel one or wait 15 minutes.';
    case 'expired':
    case 'duplicate-action':
      return 'That private preview is unavailable or expired.';
    case 'invalid-input':
      return 'Use a bio of up to 500 characters and interests of up to 300 characters without mass or role mentions.';
  }
};
