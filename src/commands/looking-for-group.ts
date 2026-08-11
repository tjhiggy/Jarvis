import { replySafely, type ReplyTarget } from '../discord/delivery.js';

export interface LookingForGroupInteraction extends ReplyTarget {
  readonly guildId: string | null;
  readonly user: Readonly<{
    id: string;
    globalName?: string | null;
    username?: string;
  }>;
  readonly options: Readonly<{ getString(name: string): string | null }>;
}

/** Posts a lightweight crew matchmaking request without creating admin-managed records. */
export const handleLookingForGroupCommand = async (
  interaction: LookingForGroupInteraction,
  dependencies: Readonly<{ enabled: boolean; channelId: string }>,
): Promise<void> => {
  if (!interaction.guildId?.trim())
    return replySafely(
      interaction,
      'This command is available only on the MuthaShip.',
      true,
    );
  if (!dependencies.enabled || !dependencies.channelId.trim())
    return replySafely(
      interaction,
      'Crew matchmaking is not configured on the MuthaShip.',
      true,
    );
  const game = interaction.options.getString('game')?.trim() ?? '';
  const details = interaction.options.getString('details')?.trim() ?? '';
  const window = interaction.options.getString('when')?.trim() ?? '';
  if (!game)
    return replySafely(
      interaction,
      'Tell me which game or activity you want crew for.',
      true,
    );
  const name =
    interaction.user.globalName?.trim() ||
    interaction.user.username?.trim() ||
    'Crew member';
  const suffix = [window && `When: ${window}`, details && `Details: ${details}`]
    .filter(Boolean)
    .join('\n');
  return replySafely(
    interaction,
    `📡 **Crew signal: ${name} is looking for a group**\nGame: ${game}${suffix ? `\n${suffix}` : ''}\n\nReply in this channel if you are joining.`,
    false,
  );
};
