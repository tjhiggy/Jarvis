import { replySafely, type ReplyTarget } from '../discord/delivery.js';
import { EventService, EventServiceError } from '../engagement/events.js';

const DEFAULT_EVENT_TIMEZONE = 'America/New_York';
const DEFAULT_EVENT_CAPACITY = 20;

export interface EventCommandInteraction extends ReplyTarget {
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
export const handleEventCommand = async (
  interaction: EventCommandInteraction,
  dependencies: Readonly<{
    enabled: boolean;
    channelId: string;
    adminRoleIds: ReadonlySet<string>;
    service?: EventService;
  }>,
): Promise<void> => {
  if (!interaction.guildId?.trim()) {
    await replySafely(
      interaction,
      'This command is available only in a server channel.',
      true,
    );
    return;
  }
  if (
    !dependencies.enabled ||
    !dependencies.service ||
    !dependencies.channelId.trim()
  ) {
    await replySafely(
      interaction,
      'Events are not configured on the MuthaShip.',
      true,
    );
    return;
  }
  const roles = new Set<string>();
  for (const role of dependencies.adminRoleIds)
    if (interaction.member?.roles?.cache?.has(role)) roles.add(role);
  try {
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') {
      const end = interaction.options.getString('end')?.trim();
      const event = await dependencies.service.create({
        guildId: interaction.guildId,
        channelId: dependencies.channelId,
        ownerUserId: interaction.user.id,
        ownerRoleIds: roles,
        title: interaction.options.getString('title') ?? '',
        description: interaction.options.getString('description') ?? '',
        start: interaction.options.getString('start') ?? '',
        timezone:
          interaction.options.getString('timezone')?.trim() ||
          DEFAULT_EVENT_TIMEZONE,
        capacity: parseOptionalPositiveInteger(
          interaction.options.getString('capacity'),
          DEFAULT_EVENT_CAPACITY,
        ),
        ...(end ? { end } : {}),
      });
      await replySafely(
        interaction,
        `Event ${event.id} is scheduled. The RSVP card is in the configured event channel.`,
        true,
      );
      return;
    }
    if (sub === 'list') {
      const events = await dependencies.service.list(interaction.guildId);
      await replySafely(
        interaction,
        events.length === 0
          ? 'No upcoming events are scheduled.'
          : events
              .map(
                (event) =>
                  `${event.id}: ${event.title} at ${event.scheduledAt.toISOString()} (${event.timezone})`,
              )
              .join('\n'),
        true,
      );
      return;
    }
    if (sub === 'details') {
      const detail = await dependencies.service.details(
        interaction.guildId,
        interaction.options.getString('id') ?? '',
      );
      await replySafely(
        interaction,
        `${detail.event.title}: ${detail.rsvps.filter((r) => r.attendance === 'confirmed').length}/${detail.event.capacity} confirmed, ${detail.rsvps.filter((r) => r.attendance === 'waitlisted').length} waitlisted.`,
        true,
      );
      return;
    }
    const event = await dependencies.service.cancel({
      guildId: interaction.guildId,
      eventId: interaction.options.getString('id') ?? '',
      actorRoleIds: roles,
    });
    await replySafely(interaction, `Event ${event.id} was cancelled.`, true);
  } catch (error) {
    const code = error instanceof EventServiceError ? error.code : '';
    await replySafely(
      interaction,
      code === 'forbidden'
        ? 'Event creation and cancellation are restricted to configured MuthaShip administrators.'
        : code === 'invalid-time'
          ? 'Use an unambiguous YYYY-MM-DD HH:mm time and a valid IANA timezone.'
          : code === 'past-time'
            ? 'The event must be in the future and end after it starts.'
            : code === 'not-found'
              ? 'That event was not found.'
              : 'The event could not be completed. Please retry later.',
      true,
    );
  }
};

function parseOptionalPositiveInteger(
  value: string | null,
  fallback: number,
): number {
  const normalized = value?.trim() ?? '';
  if (normalized === '') return fallback;
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
}
