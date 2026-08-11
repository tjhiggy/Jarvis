import { replySafely, type ReplyTarget } from '../discord/delivery.js';
import {
  buildEngagementButton,
  buildEngagementCard,
  toDiscordEngagementCard,
} from '../engagement/discord-ui.js';
import {
  DelegatedPostError,
  type DelegatedPostService,
} from '../engagement/delegated-posts.js';
export interface DelegatedPostInteraction extends ReplyTarget {
  readonly guildId: string | null;
  readonly channelId: string;
  readonly user: Readonly<{
    id: string;
    globalName?: string | null;
    username?: string;
  }>;
  readonly member?: Readonly<{
    roles?: Readonly<{ cache?: Readonly<{ has(id: string): boolean }> }>;
  }> | null;
  readonly options: Readonly<{
    getSubcommand(): string;
    getString(name: string): string | null;
  }>;
}
export async function handleDelegatedPostCommand(
  interaction: DelegatedPostInteraction,
  deps: Readonly<{
    enabled: boolean;
    channelId: string;
    adminRoleIds: ReadonlySet<string>;
    service?: DelegatedPostService;
  }>,
): Promise<void> {
  if (!interaction.guildId || !deps.enabled || !deps.service) {
    await replySafely(
      interaction,
      'Delegated transmissions are not configured on the MuthaShip.',
      true,
    );
    return;
  }
  const roleIds = new Set<string>();
  for (const id of deps.adminRoleIds)
    if (interaction.member?.roles?.cache?.has(id)) roleIds.add(id);
  try {
    const sub = interaction.options.getSubcommand();
    if (sub === 'confirm') {
      const posted = await deps.service.confirm({
        guildId: interaction.guildId,
        ownerUserId: interaction.user.id,
        draftId: interaction.options.getString('draft_id') ?? '',
      });
      return replySafely(
        interaction,
        `Transmission posted to the test channel. Delivery ID: ${posted.id}.`,
        true,
      );
    }
    if (sub === 'cancel')
      return replySafely(
        interaction,
        deps.service.cancel({
          guildId: interaction.guildId,
          ownerUserId: interaction.user.id,
          draftId: interaction.options.getString('draft_id') ?? '',
        })
          ? 'Private transmission cancelled.'
          : 'That transmission preview was not found or is not yours.',
        true,
      );
    const draft = deps.service.preview({
      guildId: interaction.guildId,
      ownerUserId: interaction.user.id,
      ownerName:
        interaction.user.globalName ??
        interaction.user.username ??
        'crew member',
      ownerRoleIds: roleIds,
      channelId: deps.channelId,
      content: interaction.options.getString('content') ?? '',
    });
    await interaction.reply({
      ...toDiscordEngagementCard(
        buildEngagementCard({
          title: 'Review MuthaShip transmission',
          description: draft.content,
          content: 'Nothing has been posted. Confirm or cancel below.',
          components: [
            {
              type: 'actionRow',
              components: [
                buildEngagementButton({
                  customId: `delegated-post:v1:${draft.id}:confirm`,
                  label: 'Confirm',
                  style: 'success',
                }),
                buildEngagementButton({
                  customId: `delegated-post:v1:${draft.id}:cancel`,
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
      error instanceof DelegatedPostError && error.code === 'forbidden'
        ? 'Delegated transmissions are restricted to configured MuthaShip administrators.'
        : error instanceof DelegatedPostError && error.code === 'invalid-input'
          ? 'Use a message between 1 and 1,500 characters.'
          : 'The transmission could not be completed. Please retry privately later.',
      true,
    );
  }
}
