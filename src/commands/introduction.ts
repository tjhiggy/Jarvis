import {
  formatIntroduction,
  IntroductionServiceError,
  type IntroductionService,
} from '../engagement/introductions.js';
import { replySafely, type ReplyTarget } from '../discord/delivery.js';
import {
  buildEngagementButton,
  buildEngagementCard,
  toDiscordEngagementCard,
} from '../engagement/discord-ui.js';

export interface IntroductionCommandInteraction extends ReplyTarget {
  readonly guildId: string | null;
  readonly user: Readonly<{
    id: string;
    globalName?: string | null;
    username?: string;
  }>;
  readonly member?: Readonly<{ displayName?: string | null }> | null;
  readonly options: Readonly<{
    getSubcommand(): string;
    getString(name: string): string | null;
  }>;
}

/** Resolve a safe, deterministic crew name from Discord identity metadata. */
export const resolveIntroductionDisplayName = (
  interaction: Pick<IntroductionCommandInteraction, 'user' | 'member'>,
  override: string | null,
): string => {
  const custom = override?.trim();
  if (custom) return custom;
  const candidates = [
    interaction.member?.displayName,
    interaction.user.globalName,
    interaction.user.username,
  ];
  const resolved = candidates.find(
    (candidate): candidate is string =>
      typeof candidate === 'string' && candidate.trim().length > 0,
  );
  return resolved?.trim() || 'Crew Member';
};

export const handleIntroductionCommand = async (
  interaction: IntroductionCommandInteraction,
  dependencies: Readonly<{
    enabled: boolean;
    channelId: string;
    service?: IntroductionService;
  }>,
): Promise<void> => {
  if (!interaction.guildId?.trim()) {
    await replySafely(
      interaction,
      'This command is available only in a server channel.',
      true,
    );
    return;
  }
  if (!dependencies.enabled || dependencies.service === undefined) {
    await replySafely(
      interaction,
      'Guided introductions are not configured on the MuthaShip.',
      true,
    );
    return;
  }
  try {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'confirm') {
      const created = await dependencies.service.confirm({
        guildId: interaction.guildId,
        ownerUserId: interaction.user.id,
        draftId: interaction.options.getString('draft_id') ?? '',
      });
      await replySafely(
        interaction,
        `Posted to the configured introduction channel. Your introduction ID is ${created.id}; use /introduction id:${created.id} to remove it.`,
        true,
      );
      return;
    }
    if (subcommand === 'cancel') {
      const cancelled = dependencies.service.cancel({
        guildId: interaction.guildId,
        ownerUserId: interaction.user.id,
        draftId: interaction.options.getString('draft_id') ?? '',
      });
      await replySafely(
        interaction,
        cancelled
          ? 'Preview cancelled. Nothing was saved or posted.'
          : 'That private preview was not found or is not yours.',
        true,
      );
      return;
    }
    const draft = await dependencies.service.preview({
      guildId: interaction.guildId,
      ownerUserId: interaction.user.id,
      channelId: dependencies.channelId,
      displayName: resolveIntroductionDisplayName(
        interaction,
        interaction.options.getString('name'),
      ),
      interests: interaction.options.getString('interests') ?? '',
      introduction: interaction.options.getString('aboard') ?? '',
    });
    await interaction.reply({
      ...toDiscordEngagementCard(
        buildEngagementCard({
          title: 'Review your introduction',
          description: formatIntroduction(draft),
          content:
            'Nothing has been saved or posted. Confirm or cancel below. The UUID commands remain available as a fallback.',
          components: [
            {
              type: 'actionRow',
              components: [
                buildEngagementButton({
                  customId: `preview:v1:introduction:${draft.id}:confirm`,
                  label: 'Confirm',
                  style: 'success',
                }),
                buildEngagementButton({
                  customId: `preview:v1:introduction:${draft.id}:cancel`,
                  label: 'Cancel',
                  style: 'danger',
                }),
              ],
            },
          ],
        }),
      ),
      ephemeral: true,
    });
  } catch (error) {
    const message =
      error instanceof IntroductionServiceError
        ? introductionErrorMessage(error.code)
        : 'The introduction could not be completed. Please retry privately later.';
    await replySafely(interaction, message, true);
  }
};

export const handleIntroductionDeletionCommand = async (
  interaction: IntroductionCommandInteraction,
  service: IntroductionService | undefined,
): Promise<void> => {
  if (!interaction.guildId?.trim()) {
    await replySafely(
      interaction,
      'This command is available only in a server channel.',
      true,
    );
    return;
  }
  if (service === undefined) {
    await replySafely(
      interaction,
      'Guided introductions are not configured on the MuthaShip.',
      true,
    );
    return;
  }
  const deleted = await service.delete({
    guildId: interaction.guildId,
    ownerUserId: interaction.user.id,
    introductionId: interaction.options.getString('id') ?? '',
  });
  await replySafely(
    interaction,
    deleted
      ? 'Your introduction and its bot-owned card were removed.'
      : 'That active introduction was not found or is not yours.',
    true,
  );
};

const introductionErrorMessage = (
  code: IntroductionServiceError['code'],
): string => {
  switch (code) {
    case 'missing-channel':
      return 'Introductions need a configured destination channel before anything can be posted.';
    case 'opted-out':
      return 'You have opted out of engagement collection, so no introduction was saved or posted.';
    case 'duplicate':
      return 'You already have an active introduction. Delete it before posting another.';
    case 'rate-limit':
      return 'Too many introduction attempts. Please retry shortly.';
    case 'invalid-input':
      return 'Use a name, interests, and aboard message within the stated limits.';
  }
};
