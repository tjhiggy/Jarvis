import { replySafely, type ReplyTarget } from '../discord/delivery.js';
import type { EventService } from '../engagement/events.js';

export interface GameNightInteraction extends ReplyTarget {
  readonly guildId: string | null;
  readonly user: Readonly<{ id: string }>;
  readonly member?: Readonly<{
    roles?: Readonly<{ cache?: Readonly<{ has(id: string): boolean }> }>;
  }> | null;
  readonly options: Readonly<{
    getSubcommand(): string;
    getString(name: string): string | null;
  }>;
}

/** A low-friction gaming wrapper over the event/RSVP system. */
export const handleGameNightCommand = async (
  interaction: GameNightInteraction,
  dependencies: Readonly<{
    enabled: boolean;
    channelId: string;
    adminRoleIds: ReadonlySet<string>;
    service?: EventService;
  }>,
): Promise<void> => {
  if (!interaction.guildId?.trim())
    return replySafely(
      interaction,
      'This command is available only in a MuthaShip server.',
      true,
    );
  if (
    !dependencies.enabled ||
    !dependencies.service ||
    !dependencies.channelId.trim()
  )
    return replySafely(
      interaction,
      'Game nights are not configured on the MuthaShip.',
      true,
    );
  const isAdmin = [...dependencies.adminRoleIds].some((role) =>
    interaction.member?.roles?.cache?.has(role),
  );
  try {
    const sub = interaction.options.getSubcommand();
    if (sub === 'list') {
      const events = (
        await dependencies.service.list(interaction.guildId)
      ).filter((event) => event.title.startsWith('Game Night:'));
      return replySafely(
        interaction,
        events.length
          ? events
              .map(
                (event) =>
                  `${event.id}: ${event.title} at ${event.scheduledAt.toISOString()}`,
              )
              .join('\n')
          : 'No game nights are scheduled.',
        true,
      );
    }
    if (!isAdmin)
      return replySafely(
        interaction,
        'Only configured MuthaShip administrators can schedule game nights.',
        true,
      );
    const game = interaction.options.getString('game')?.trim() ?? '';
    const start = interaction.options.getString('start')?.trim() ?? '';
    const details =
      interaction.options.getString('details')?.trim() ||
      `Crew game night for ${game}. RSVP below if you are joining.`;
    const event = await dependencies.service.create({
      guildId: interaction.guildId,
      channelId: dependencies.channelId,
      ownerUserId: interaction.user.id,
      ownerRoleIds: new Set(
        [...dependencies.adminRoleIds].filter((role) =>
          interaction.member?.roles?.cache?.has(role),
        ),
      ),
      title: `Game Night: ${game}`,
      description: details,
      start,
      timezone:
        interaction.options.getString('timezone')?.trim() || 'America/New_York',
      capacity: Number(interaction.options.getString('capacity')?.trim() || 20),
    });
    return replySafely(
      interaction,
      `Game night ${event.id} is scheduled. The RSVP card is in the configured event channel.`,
      true,
    );
  } catch {
    return replySafely(
      interaction,
      'The game night could not be scheduled. Check the game name and future start time, then retry.',
      true,
    );
  }
};
