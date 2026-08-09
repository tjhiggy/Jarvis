import { replySafely, type ReplyTarget } from '../discord/delivery.js';
import {
  buildEngagementButton,
  buildEngagementCard,
  toDiscordEngagementCard,
} from '../engagement/discord-ui.js';
import { TriviaService, TriviaServiceError } from '../engagement/activity.js';

export const handleTriviaCommand = async (
  interaction: ReplyTarget & {
    readonly guildId: string | null;
    readonly channelId: string;
    readonly user: { readonly id: string };
    readonly options: { getSubcommand(): string };
  },
  dependencies: {
    readonly enabled: boolean;
    readonly channelId: string;
    readonly retentionDays?: number;
    readonly service?: TriviaService;
  },
): Promise<void> => {
  if (!interaction.guildId?.trim())
    return replySafely(
      interaction,
      'This command is available only in a server channel.',
      true,
    );
  if (!dependencies.enabled || !dependencies.service)
    return replySafely(
      interaction,
      'Trivia is not configured in this channel.',
      true,
    );
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'opt-out') {
    try {
      await dependencies.service.optOut(
        interaction.guildId,
        interaction.user.id,
      );
      return replySafely(
        interaction,
        'Trivia participation is off. Your retained activity records were removed; you can use `/trivia opt-in` later.',
        true,
      );
    } catch {
      return replySafely(
        interaction,
        'Trivia preferences could not be updated. Please retry later.',
        true,
      );
    }
  }
  if (subcommand === 'opt-in') {
    try {
      await dependencies.service.optIn(
        interaction.guildId,
        interaction.user.id,
      );
      return replySafely(
        interaction,
        'Trivia participation is on for future rounds.',
        true,
      );
    } catch {
      return replySafely(
        interaction,
        'Trivia preferences could not be updated. Please retry later.',
        true,
      );
    }
  }
  if (interaction.channelId !== dependencies.channelId)
    return replySafely(
      interaction,
      'Trivia is not configured in this channel.',
      true,
    );
  if (subcommand !== 'start')
    return replySafely(
      interaction,
      'Use `/trivia start` to open one short round.',
      true,
    );
  try {
    const round = await dependencies.service.start({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      ownerUserId: interaction.user.id,
    });
    await interaction.reply(
      toDiscordEngagementCard(
        buildEngagementCard({
          title: 'MuthaShip trivia',
          description: `${round.question.prompt}\n\nChoose one answer. This round closes in one minute. Participation is optional; only your ID and correctness are retained for up to ${dependencies.retentionDays ?? 30} days.`,
          components: [
            {
              type: 'actionRow',
              components: round.question.answers.map((answer, index) =>
                buildEngagementButton({
                  customId: `trivia:v1:${round.id}:${index}`,
                  label: answer,
                  style: 'secondary',
                }),
              ),
            },
          ],
        }),
      ),
    );
  } catch (error) {
    await replySafely(
      interaction,
      error instanceof TriviaServiceError && error.code === 'already-open'
        ? 'A trivia round is already open here. Let it finish first.'
        : error instanceof TriviaServiceError && error.code === 'opted-out'
          ? 'You have opted out of engagement collection.'
          : 'Trivia could not start. Please retry later.',
      true,
    );
  }
};
