import {
  formatIntroduction,
  IntroductionServiceError,
  type IntroductionService,
} from '../engagement/introductions.js';
import { replySafely, type ReplyTarget } from '../discord/delivery.js';

export interface IntroductionCommandInteraction extends ReplyTarget {
  readonly guildId: string | null;
  readonly user: Readonly<{ id: string }>;
  readonly options: Readonly<{
    getSubcommand(): string;
    getString(name: string): string | null;
  }>;
}

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
      displayName: interaction.options.getString('name') ?? '',
      interests: interaction.options.getString('interests') ?? '',
      introduction: interaction.options.getString('aboard') ?? '',
    });
    await replySafely(
      interaction,
      `Private preview:\n${formatIntroduction(draft)}\n\nNothing has been saved or posted. Use /introduce confirm draft_id:${draft.id} to post, or /introduce cancel draft_id:${draft.id} to discard it.`,
      true,
    );
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
