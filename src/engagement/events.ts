import {
  buildEngagementButton,
  buildEngagementCard,
  type EngagementCard,
} from './discord-ui.js';
import type { Event, Rsvp, RsvpResponse } from './domain.js';
import {
  EngagementEventClosedError,
  EngagementOptOutError,
  type EngagementRepository,
} from './storage.js';
import { requirePlainText } from './safety.js';

export type EventServiceErrorCode =
  | 'forbidden'
  | 'invalid-input'
  | 'invalid-time'
  | 'past-time'
  | 'not-found'
  | 'cancelled'
  | 'closed'
  | 'opted-out'
  | 'duplicate-action';
export class EventServiceError extends Error {
  constructor(readonly code: EventServiceErrorCode) {
    super(code);
  }
}
type EventRepository = EngagementRepository &
  Required<
    Pick<EngagementRepository, 'listEvents' | 'listRsvps' | 'respondToEvent'>
  >;
export interface EventGateway {
  post(channelId: string, card: EngagementCard): Promise<{ id: string }>;
}

export class EventService {
  constructor(
    private readonly dependencies: Readonly<{
      repository: EventRepository;
      createId: () => string;
      adminRoleIds: ReadonlySet<string>;
      gateway?: EventGateway;
      now?: () => Date;
    }>,
  ) {}

  async create(
    input: Readonly<{
      guildId: string;
      channelId: string;
      ownerUserId: string;
      ownerRoleIds: ReadonlySet<string>;
      title: string;
      description: string;
      start: string;
      timezone: string;
      capacity: number;
      end?: string;
    }>,
  ): Promise<Event> {
    if (
      ![...this.dependencies.adminRoleIds].some((role) =>
        input.ownerRoleIds.has(role),
      )
    )
      throw new EventServiceError('forbidden');
    let title: string;
    let description: string;
    try {
      title = requirePlainText(input.title, 200, 'Title');
      description = requirePlainText(input.description, 2_000, 'Description');
    } catch {
      throw new EventServiceError('invalid-input');
    }
    const scheduledAt = zonedWallTimeToUtc(input.start, input.timezone);
    const endsAt = input.end?.trim()
      ? zonedWallTimeToUtc(input.end, input.timezone)
      : undefined;
    const now = this.now();
    if (
      scheduledAt.getTime() <= now.getTime() ||
      (endsAt && endsAt <= scheduledAt)
    )
      throw new EventServiceError('past-time');
    if (!Number.isSafeInteger(input.capacity) || input.capacity < 1)
      throw new EventServiceError('invalid-input');
    const value: Event = {
      id: this.dependencies.createId(),
      guildId: input.guildId.trim(),
      channelId: input.channelId.trim(),
      ownerUserId: input.ownerUserId.trim(),
      title,
      description,
      scheduledAt,
      ...(endsAt ? { endsAt } : {}),
      timezone: input.timezone.trim(),
      capacity: input.capacity,
      status: 'scheduled',
      createdAt: now,
      updatedAt: now,
    };
    if (!value.guildId || !value.channelId || !value.ownerUserId)
      throw new EventServiceError('invalid-input');
    try {
      const event = await this.dependencies.repository.createEvent(value);
      if (this.dependencies.gateway) {
        try {
          const message = await this.dependencies.gateway.post(
            event.channelId,
            buildEventCard(event),
          );
          return (
            (await this.dependencies.repository.updateEventMessageId?.(
              event.guildId,
              event.id,
              message.id,
            )) ?? event
          );
        } catch {
          await this.dependencies.repository.markEventDestinationMissed?.(
            event.guildId,
            event.id,
            this.now(),
          );
          return event;
        }
      }
      return event;
    } catch (error) {
      if (error instanceof EngagementOptOutError)
        throw new EventServiceError('opted-out');
      if (error instanceof EngagementEventClosedError)
        throw new EventServiceError('closed');
      throw error;
    }
  }

  async list(guildId: string): Promise<Event[]> {
    return this.dependencies.repository.listEvents(
      guildId.trim(),
      this.now(),
      50,
    );
  }
  async details(
    guildId: string,
    eventId: string,
  ): Promise<{ event: Event; rsvps: Rsvp[] }> {
    const event = await this.dependencies.repository.getEvent(
      guildId.trim(),
      eventId.trim(),
    );
    if (!event) throw new EventServiceError('not-found');
    return {
      event,
      rsvps: await this.dependencies.repository.listRsvps(
        event.guildId,
        event.id,
      ),
    };
  }
  async cancel(
    input: Readonly<{
      guildId: string;
      eventId: string;
      actorRoleIds: ReadonlySet<string>;
    }>,
  ): Promise<Event> {
    if (
      ![...this.dependencies.adminRoleIds].some((role) =>
        input.actorRoleIds.has(role),
      )
    )
      throw new EventServiceError('forbidden');
    const event = await this.dependencies.repository.updateEventStatus(
      input.guildId.trim(),
      input.eventId.trim(),
      'cancelled',
      this.now(),
    );
    if (!event) throw new EventServiceError('not-found');
    return event;
  }
  async rsvp(
    input: Readonly<{
      guildId: string;
      eventId: string;
      userId: string;
      response: RsvpResponse;
      interactionId: string;
      reminderOptIn?: boolean;
    }>,
  ): Promise<Rsvp> {
    const event = await this.dependencies.repository.getEvent(
      input.guildId.trim(),
      input.eventId.trim(),
    );
    if (!event) throw new EventServiceError('not-found');
    if (event.status !== 'scheduled') throw new EventServiceError('cancelled');
    const now = this.now();
    if (
      !(await this.dependencies.repository.claimIdempotencyKey(
        event.guildId,
        'interaction',
        input.interactionId.trim(),
        now,
      ))
    )
      throw new EventServiceError('duplicate-action');
    try {
      return await this.dependencies.repository.respondToEvent({
        eventId: event.id,
        guildId: event.guildId,
        userId: input.userId.trim(),
        response: input.response,
        attendance: 'none',
        reminderOptIn: input.reminderOptIn ?? false,
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (error instanceof EngagementOptOutError)
        throw new EventServiceError('opted-out');
      if (error instanceof EngagementEventClosedError)
        throw new EventServiceError('closed');
      throw error;
    }
  }
  private now(): Date {
    return (this.dependencies.now ?? (() => new Date()))();
  }
}

export const buildEventCard = (event: Event): EngagementCard =>
  buildEngagementCard({
    title: `Event: ${event.title}`,
    description: event.description,
    fields: [
      {
        name: 'When',
        value: `${event.scheduledAt.toISOString().replace('.000Z', 'Z')} (${event.timezone})`,
      },
      { name: 'Capacity', value: String(event.capacity) },
    ],
    components: [
      {
        type: 'actionRow',
        components: [
          buildEngagementButton({
            customId: `event:v1:${event.id}:yes`,
            label: 'Yes',
            style: 'success',
          }),
          buildEngagementButton({
            customId: `event:v1:${event.id}:maybe`,
            label: 'Maybe',
            style: 'secondary',
          }),
          buildEngagementButton({
            customId: `event:v1:${event.id}:no`,
            label: 'No',
            style: 'danger',
          }),
          buildEngagementButton({
            customId: `event:v1:${event.id}:remind`,
            label: 'Yes + reminder',
            style: 'primary',
          }),
        ],
      },
    ],
  });

export const zonedWallTimeToUtc = (value: string, timezone: string): Date => {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/.exec(
    value.trim(),
  );
  if (!match) throw new EventServiceError('invalid-time');
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    throw new EventServiceError('invalid-time');
  }
  const target = `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
  const base = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  const candidates: Date[] = [];
  for (
    let time = base - 15 * 3_600_000;
    time <= base + 15 * 3_600_000;
    time += 60_000
  ) {
    const date = new Date(time);
    if (formatWall(date, timezone) === target) candidates.push(date);
  }
  if (candidates.length !== 1) throw new EventServiceError('invalid-time');
  return candidates[0]!;
};
const formatWall = (date: Date, timezone: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (name: string) =>
    parts.find((part) => part.type === name)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}`;
};
