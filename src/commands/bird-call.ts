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

/** Discord's @everyone role id is the guild id; `<@&guildId>` is a mass ping. */
const neutralizeEveryoneRoleMention = (
  content: string,
  guildId: string,
): string => {
  const everyoneRoleId = guildId.trim();
  if (!everyoneRoleId) {
    return content;
  }

  const token = `<@&${everyoneRoleId}>`;
  return content.split(token).join(`<@&\u200b${everyoneRoleId}>`);
};

/** Neutralize mass, user, and channel mentions while leaving other role tokens intact. */
const neutralizeBirdCallGame = (content: string, guildId = ''): string =>
  neutralizeEveryoneRoleMention(content, guildId)
    .replace(/@(?=everyone\b|here\b)/gi, '@\u200b')
    .replace(/<@(?=!\d+>)/g, '<@\u200b')
    .replace(/<@(?=\d+>)/g, '<@\u200b')
    .replace(/<#(?=\d+>)/g, '<#\u200b');

const extractBirdCallRoleIds = (
  content: string,
  everyoneRoleId = '',
): readonly string[] => {
  const blocked = everyoneRoleId.trim();
  const roles: string[] = [];
  const seen = new Set<string>();
  for (const match of content.matchAll(/<@&(\d+)>/g)) {
    const roleId = match[1];
    if (!roleId || seen.has(roleId) || roleId === blocked) continue;
    seen.add(roleId);
    roles.push(roleId);
  }
  return roles;
};

const birdCallAllowedMentions = (
  game: string,
  guildId = '',
): AllowedMentions => {
  const roles = extractBirdCallRoleIds(game, guildId);
  return roles.length === 0 ? allowedMentions : { ...allowedMentions, roles };
};

export const formatBirdCallMessage = (game = '', guildId = ''): string => {
  const safeGame = neutralizeBirdCallGame(game, guildId).trim();
  return safeGame
    ? `Bird call. Who on the MuthaShip wants to play ${safeGame} now?`
    : 'Bird call. Who on the MuthaShip wants to game now?';
};

const replyPublicBirdCall = async (
  interaction: BirdCallInteraction,
  game: string,
): Promise<void> => {
  const guildId = interaction.guildId?.trim() ?? '';
  const safeGame = neutralizeBirdCallGame(game, guildId);
  await interaction.reply({
    content: formatBirdCallMessage(game, guildId),
    ephemeral: false,
    allowedMentions: birdCallAllowedMentions(safeGame, guildId),
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
