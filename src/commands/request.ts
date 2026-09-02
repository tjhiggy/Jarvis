import {
  allowedMentions,
  replySafely,
  type ReplyTarget,
} from '../discord/delivery.js';
import { neutralizeDiscordMentions } from '../utils/mentions.js';

export const CAPTAINS_QUARTERS_CHANNEL_ID = '953011731356086283';

const wrongChannelMessage =
  'The /request command is only available in captains-quarters.';
const administratorMessage =
  'Request posting is restricted to configured MuthaShip administrators.';

export interface RequestCommandInteraction extends ReplyTarget {
  readonly guildId: string | null;
  readonly channelId: string;
  readonly member?: Readonly<{
    roles?: Readonly<{ cache?: Readonly<{ has(id: string): boolean }> }>;
  }> | null;
  readonly options: Readonly<{
    getString(name: string): string | null;
  }>;
}

export const formatRequestMessage = (
  what: string,
  why: string,
  done: string,
): string =>
  [
    'REQUEST',
    `what: ${neutralizeDiscordMentions(what).trim()}`,
    `why: ${neutralizeDiscordMentions(why).trim()}`,
    `done: ${neutralizeDiscordMentions(done).trim()}`,
  ].join('\n');

const isAdministrator = (
  interaction: RequestCommandInteraction,
  adminRoleIds: ReadonlySet<string>,
): boolean =>
  [...adminRoleIds].some((roleId) =>
    interaction.member?.roles?.cache?.has(roleId),
  );

export async function handleRequestCommand(
  interaction: RequestCommandInteraction,
  dependencies: Readonly<{
    adminRoleIds: ReadonlySet<string>;
    channelId?: string;
  }>,
): Promise<void> {
  if (!interaction.guildId?.trim()) {
    await replySafely(
      interaction,
      'This command is available only in a server channel.',
      true,
    );
    return;
  }
  const channelId = (dependencies.channelId ?? CAPTAINS_QUARTERS_CHANNEL_ID).trim();
  if (interaction.channelId.trim() !== channelId) {
    await replySafely(interaction, wrongChannelMessage, true);
    return;
  }
  if (!isAdministrator(interaction, dependencies.adminRoleIds)) {
    await replySafely(interaction, administratorMessage, true);
    return;
  }
  const what = interaction.options.getString('what')?.trim() ?? '';
  const why = interaction.options.getString('why')?.trim() ?? '';
  const done = interaction.options.getString('done')?.trim() ?? '';
  if (what === '' || why === '' || done === '') {
    await replySafely(
      interaction,
      'Provide what, why, and done for this request.',
      true,
    );
    return;
  }
  await interaction.reply({
    content: formatRequestMessage(what, why, done),
    ephemeral: false,
    allowedMentions,
  });
}
