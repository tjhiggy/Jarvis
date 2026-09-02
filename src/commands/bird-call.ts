import { replySafely, type ReplyTarget } from '../discord/delivery.js';
import { neutralizeDiscordMentions } from '../utils/mentions.js';

export interface BirdCallInteraction extends ReplyTarget {
  readonly guildId: string | null;
  readonly options: Readonly<{
    getString(name: string): string | null;
  }>;
}

const dmMessage = 'This command is available only in a server channel.';

export const formatBirdCallMessage = (game = ''): string => {
  const safeGame = neutralizeDiscordMentions(game).trim();
  return safeGame
    ? `Bird call. Who on the MuthaShip wants to play ${safeGame} now?`
    : 'Bird call. Who on the MuthaShip wants to game now?';
};

/** Posts one public instant gaming invite. Does not replace /lfg or /game-night. */
export const handleBirdCallCommand = async (
  interaction: BirdCallInteraction,
): Promise<void> => {
  if (!interaction.guildId?.trim()) {
    await replySafely(interaction, dmMessage, true);
    return;
  }

  const game = interaction.options.getString('game')?.trim() ?? '';
  await replySafely(interaction, formatBirdCallMessage(game), false);
};
