import { replySafely, type ReplyTarget } from '../discord/delivery.js';
import {
  buildEngagementButton,
  buildEngagementCard,
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
    readonly service?: TriviaService;
  },
): Promise<void> => {
  if (!interaction.guildId?.trim())
    return replySafely(
      interaction,
      'This command is available only in a server channel.',
      true,
    );
  if (
    !dependencies.enabled ||
    !dependencies.service ||
    interaction.channelId !== dependencies.channelId
  )
    return replySafely(
      interaction,
      'Trivia is not configured in this channel.',
      true,
    );
  if (interaction.options.getSubcommand() !== 'start')
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
      buildEngagementCard({
        title: 'MuthaShip trivia',
        description: `${round.question.prompt}\n\nChoose one answer. This round closes in one minute. Participation is optional; only your ID and correctness are retained for up to 30 days.`,
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
