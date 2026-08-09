import {
  buildSuggestionCard,
  SuggestionServiceError,
  type SuggestionService,
} from '../engagement/suggestions.js';
import { replySafely, type ReplyTarget } from '../discord/delivery.js';
import {
  buildEngagementButton,
  buildEngagementCard,
  toDiscordEngagementCard,
} from '../engagement/discord-ui.js';

export interface SuggestionCommandInteraction extends ReplyTarget {
  readonly guildId: string | null;
  readonly user: Readonly<{ id: string }>;
  readonly options: Readonly<{
    getSubcommand(): string;
    getString(name: string): string | null;
  }>;
}

export const handleSuggestionCommand = async (
  interaction: SuggestionCommandInteraction,
  dependencies: Readonly<{
    enabled: boolean;
    channelId: string;
    service?: SuggestionService;
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
      'Suggestions are not configured on the MuthaShip.',
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
        `Posted to the configured suggestion channel. Your suggestion ID is ${created.id}; use /suggestion delete id:${created.id} before it is triaged.`,
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
          ? 'Private preview cancelled. Nothing was saved or posted.'
          : 'That private preview was not found or is not yours.',
        true,
      );
      return;
    }
    const draft = await dependencies.service.preview({
      guildId: interaction.guildId,
      ownerUserId: interaction.user.id,
      channelId: dependencies.channelId,
      title: interaction.options.getString('title') ?? '',
      description: interaction.options.getString('description') ?? '',
    });
    const card = buildSuggestionCard(draft);
    await interaction.reply({
      ...toDiscordEngagementCard(
        buildEngagementCard({
          title: `Review: ${card.embeds[0]?.title ?? 'Suggestion'}`,
          ...(card.embeds[0]?.description === undefined
            ? {}
            : { description: card.embeds[0].description }),
          content:
            'Nothing has been saved or posted. Confirm or cancel below. The UUID commands remain available as a fallback.',
          components: [
            {
              type: 'actionRow',
              components: [
                buildEngagementButton({
                  customId: `preview:v1:suggestion:${draft.id}:confirm`,
                  label: 'Confirm',
                  style: 'success',
                }),
                buildEngagementButton({
                  customId: `preview:v1:suggestion:${draft.id}:cancel`,
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
    await replySafely(
      interaction,
      error instanceof SuggestionServiceError
        ? suggestionErrorMessage(error.code)
        : 'The suggestion could not be completed. Please retry privately later.',
      true,
    );
  }
};

export const handleSuggestionDeletionCommand = async (
  interaction: SuggestionCommandInteraction,
  service: SuggestionService | undefined,
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
      'Suggestions are not configured on the MuthaShip.',
      true,
    );
    return;
  }
  try {
    const deleted = await service.delete({
      guildId: interaction.guildId,
      ownerUserId: interaction.user.id,
      suggestionId: interaction.options.getString('id') ?? '',
    });
    await replySafely(
      interaction,
      deleted
        ? 'Your untriaged suggestion and its bot-owned card were removed.'
        : 'That open suggestion was not found, is not yours, or has already been triaged.',
      true,
    );
  } catch {
    await replySafely(
      interaction,
      'The suggestion could not be removed right now. Please retry later.',
      true,
    );
  }
};

const suggestionErrorMessage = (
  code: SuggestionServiceError['code'],
): string => {
  switch (code) {
    case 'missing-channel':
      return 'Suggestions need a configured destination channel before anything can be posted.';
    case 'opted-out':
      return 'You have opted out of engagement collection, so no suggestion was saved or posted.';
    case 'duplicate':
      return 'That suggestion is already awaiting triage.';
    case 'rate-limit':
      return 'Too many suggestion attempts. Please retry shortly.';
    case 'invalid-input':
      return 'Use a title and description within the stated limits.';
    case 'persistence-failed':
      return 'Your suggestion needs administrator cleanup before it can be confirmed. Please do not submit it again yet.';
    default:
      return 'That suggestion control is unavailable.';
  }
};
