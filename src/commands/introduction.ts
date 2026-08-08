import {
  IntroductionServiceError,
  type IntroductionService,
} from '../engagement/introductions.js';
import { replySafely, type ReplyTarget } from '../discord/delivery.js';

export interface IntroductionCommandInteraction extends ReplyTarget {
  readonly guildId: string | null;
  readonly user: Readonly<{ id: string }>;
  readonly options: Readonly<{ getString(name: string): string | null }>;
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
    const created = await dependencies.service.submit({
      guildId: interaction.guildId,
      ownerUserId: interaction.user.id,
      channelId: dependencies.channelId,
      displayName: interaction.options.getString('name') ?? '',
      interests: interaction.options.getString('interests') ?? '',
      introduction: interaction.options.getString('aboard') ?? '',
    });
    await replySafely(
      interaction,
      `Preview confirmed and posted to the configured introduction channel. Your introduction ID is ${created.id}; use /introduction delete id:${created.id} to remove it.`,
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
