import {
  allowedMentions,
  replySafely,
  type AllowedMentions,
  type ReplyTarget,
} from '../discord/delivery.js';

export interface BirdCallInteraction extends ReplyTarget {
  readonly guildId: string | null;
  readonly options: Readonly<{
    getString(name: string): string | null;
  }>;
}

const dmMessage = 'This command is available only in a server channel.';

/** Neutralize mass, user, and channel mentions while leaving role tokens intact. */
const neutralizeBirdCallGame = (content: string): string =>
  content
    .replace(/@(?=everyone\b|here\b)/gi, '@\u200b')
    .replace(/<@(?=!\d+>)/g, '<@\u200b')
    .replace(/<@(?=\d+>)/g, '<@\u200b')
    .replace(/<#(?=\d+>)/g, '<#\u200b');

const extractBirdCallRoleIds = (content: string): readonly string[] => {
  const roles: string[] = [];
  const seen = new Set<string>();
  for (const match of content.matchAll(/<@&(\d+)>/g)) {
    const roleId = match[1];
    if (!roleId || seen.has(roleId)) continue;
    seen.add(roleId);
    roles.push(roleId);
  }
  return roles;
};

const birdCallAllowedMentions = (game: string): AllowedMentions => {
  const roles = extractBirdCallRoleIds(game);
  return roles.length === 0 ? allowedMentions : { ...allowedMentions, roles };
};

export const formatBirdCallMessage = (game = ''): string => {
  const safeGame = neutralizeBirdCallGame(game).trim();
  return safeGame
    ? `Bird call. Who on the MuthaShip wants to play ${safeGame} now?`
    : 'Bird call. Who on the MuthaShip wants to game now?';
};

const replyPublicBirdCall = async (
  interaction: BirdCallInteraction,
  game: string,
): Promise<void> => {
  await interaction.reply({
    content: formatBirdCallMessage(game),
    ephemeral: false,
    allowedMentions: birdCallAllowedMentions(game),
  });
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
  await replyPublicBirdCall(interaction, game);
};
