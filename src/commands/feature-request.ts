import {
  editDeferredReplySafely,
  replySafely,
  type DeferredReplyTarget,
  type ReplyPayload,
  type ReplyTarget,
} from '../discord/delivery.js';
import type { FeatureRequestService } from '../github/feature-request.js';

export interface FeatureRequestInteraction extends ReplyTarget {
  deferReply(payload: ReplyPayload): Promise<unknown>;
  editReply(payload: ReplyPayload): Promise<unknown>;
  followUp(payload: ReplyPayload): Promise<unknown>;
  readonly guildId: string | null;
  readonly channelId: string;
  readonly user: Readonly<{ id: string }>;
  readonly member?: Readonly<{
    roles?: Readonly<{ cache?: Readonly<{ has(id: string): boolean }> }>;
  }> | null;
  readonly options: Readonly<{
    getSubcommand(): string;
    getString(name: string): string | null;
  }>;
}

export async function handleFeatureRequestCommand(
  interaction: FeatureRequestInteraction,
  dependencies: Readonly<{
    adminRoleIds: ReadonlySet<string>;
    service?: Pick<FeatureRequestService, 'preview' | 'confirm' | 'cancel'>;
  }>,
): Promise<void> {
  let deferred = false;
  if (!interaction.guildId || !dependencies.service) {
    await replySafely(
      interaction,
      'GitHub feature intake is not configured on the MuthaShip.',
      true,
    );
    return;
  }
  const authorized = [...dependencies.adminRoleIds].some((roleId) =>
    interaction.member?.roles?.cache?.has(roleId),
  );
  if (!authorized) {
    await replySafely(
      interaction,
      'Feature requests are restricted to configured MuthaShip administrators.',
      true,
    );
    return;
  }
  try {
    const subcommand = interaction.options.getSubcommand();
    const draftId = interaction.options.getString('draft_id') ?? '';
    if (subcommand === 'confirm') {
      await interaction.deferReply({ ephemeral: true });
      deferred = true;
      const result = await dependencies.service.confirm({
        draftId,
        serverId: interaction.guildId,
        channelId: interaction.channelId,
        ownerId: interaction.user.id,
      });
      await editDeferredReplySafely(
        interaction as DeferredReplyTarget,
        `GitHub issue #${result.number} created.\n${result.url}`,
      );
      return;
    }
    if (subcommand === 'cancel') {
      const cancelled = dependencies.service.cancel({
        draftId,
        serverId: interaction.guildId,
        channelId: interaction.channelId,
        ownerId: interaction.user.id,
      });
      await replySafely(
        interaction,
        cancelled
          ? 'Feature-request preview cancelled.'
          : 'That preview was not found or is not yours.',
        true,
      );
      return;
    }
    const draft = dependencies.service.preview({
      serverId: interaction.guildId,
      channelId: interaction.channelId,
      ownerId: interaction.user.id,
      title: interaction.options.getString('title') ?? '',
      description: interaction.options.getString('description') ?? '',
    });
    await replySafely(
      interaction,
      [
        'Private GitHub issue preview. Nothing has been created.',
        `Title: ${draft.title}`,
        `Description: ${draft.description}`,
        `Confirm with \`/feature-request confirm draft_id:${draft.id}\` or cancel with \`/feature-request cancel draft_id:${draft.id}\`.`,
      ].join('\n'),
      true,
    );
  } catch {
    const message =
      'The feature request could not be completed. Check the input or retry after GitHub is available.';
    if (deferred) {
      await editDeferredReplySafely(
        interaction as DeferredReplyTarget,
        message,
      );
    } else {
      await replySafely(interaction, message, true);
    }
  }
}
