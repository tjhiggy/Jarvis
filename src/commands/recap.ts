import { replySafely, type ReplyTarget } from '../discord/delivery.js';
import type { RecapService } from '../engagement/recap.js';
import type { EngagementRepository } from '../engagement/storage.js';

export const handleRecapCommand = async (
  interaction: ReplyTarget & {
    guildId: string | null;
    member?: { roles?: { cache?: { has(id: string): boolean } } } | null;
    options: { getSubcommand(): string };
  },
  dependencies: {
    enabled: boolean;
    channelId: string;
    schedule: string;
    adminRoleIds: ReadonlySet<string>;
    service?: RecapService;
    repository?: Required<Pick<EngagementRepository, 'setRecapEnabled'>>;
    now?: () => Date;
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
    !dependencies.channelId.trim() ||
    !dependencies.service ||
    !dependencies.repository
  )
    return replySafely(
      interaction,
      'Weekly recaps are not configured on the MuthaShip.',
      true,
    );
  const admin = [...dependencies.adminRoleIds].some((role) =>
    interaction.member?.roles?.cache?.has(role),
  );
  if (!admin)
    return replySafely(
      interaction,
      'Weekly recap controls are restricted to configured MuthaShip administrators.',
      true,
    );
  const subcommand = interaction.options.getSubcommand();
  if (
    subcommand === 'enable' ||
    subcommand === 'pause' ||
    subcommand === 'resume'
  ) {
    if (
      (subcommand === 'enable' || subcommand === 'resume') &&
      !dependencies.schedule.trim()
    )
      return replySafely(
        interaction,
        'Configure a weekly recap schedule and timezone before enabling scheduled recaps. Preview remains available.',
        true,
      );
    const enabled = subcommand !== 'pause';
    await dependencies.repository.setRecapEnabled(
      interaction.guildId,
      enabled,
      (dependencies.now ?? (() => new Date()))(),
    );
    return replySafely(
      interaction,
      enabled
        ? 'Weekly recaps are enabled for this guild.'
        : 'Weekly recaps are paused for this guild.',
      true,
    );
  }
  const end = (dependencies.now ?? (() => new Date()))();
  const recap = await dependencies.service.preview(interaction.guildId, {
    start: new Date(end.getTime() - 7 * 24 * 60 * 60 * 1_000),
    end,
  });
  return replySafely(
    interaction,
    recap.content ??
      'Recap source data is unavailable, so Jarvis will not publish a recap.',
    true,
  );
};
