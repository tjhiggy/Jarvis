import { describe, expect, it } from 'vitest';
import { EventService, EventServiceError } from '../src/engagement/events.js';
import { handleEventCommand } from '../src/commands/event.js';

describe('event creation', () => {
  it('uses practical defaults so administrators only need title, details, and start', async () => {
    const captured: Record<string, unknown> = {};
    const interaction = commandInteraction({
      title: 'Crew game night',
      description: 'Join the crew for a match.',
      start: '2026-08-09 15:30',
      timezone: null,
      capacity: null,
    });
    await handleEventCommand(interaction, {
      enabled: true,
      channelId: 'events',
      adminRoleIds: new Set(['admin']),
      service: {
        create: async (input: Record<string, unknown>) => {
          Object.assign(captured, input);
          return { id: 'event-1' };
        },
      } as any,
    });
    expect(captured).toMatchObject({
      timezone: 'America/New_York',
      capacity: 20,
    });
  });

  it('converts an unambiguous zoned wall time to UTC and retains the zone label', async () => {
    const service = new EventService({
      repository: repository(),
      createId: () => 'event-1',
      adminRoleIds: new Set(['admin']),
      now: () => new Date('2026-08-08T12:00:00Z'),
    });
    await expect(
      service.create({
        guildId: 'g',
        channelId: 'c',
        ownerUserId: 'u',
        ownerRoleIds: new Set(['admin']),
        title: 'Launch',
        description: 'Ready',
        start: '2026-08-09 15:30',
        timezone: 'America/New_York',
        capacity: 4,
      }),
    ).resolves.toMatchObject({
      scheduledAt: new Date('2026-08-09T19:30:00.000Z'),
      timezone: 'America/New_York',
    });
  });

  it('rejects an ambiguous fall-back wall time and non-administrators', async () => {
    const service = new EventService({
      repository: repository(),
      createId: () => 'event-1',
      adminRoleIds: new Set(['admin']),
      now: () => new Date('2026-08-08T12:00:00Z'),
    });
    await expect(
      service.create({
        guildId: 'g',
        channelId: 'c',
        ownerUserId: 'u',
        ownerRoleIds: new Set(['admin']),
        title: 'Launch',
        description: 'Ready',
        start: '2026-11-01 01:30',
        timezone: 'America/New_York',
        capacity: 4,
      }),
    ).rejects.toMatchObject({
      code: 'invalid-time',
    } satisfies Partial<EventServiceError>);
    await expect(
      service.create({
        guildId: 'g',
        channelId: 'c',
        ownerUserId: 'u',
        ownerRoleIds: new Set(),
        title: 'Launch',
        description: 'Ready',
        start: '2026-08-09 15:30',
        timezone: 'UTC',
        capacity: 4,
      }),
    ).rejects.toMatchObject({
      code: 'forbidden',
    } satisfies Partial<EventServiceError>);
  });
});

function commandInteraction(values: Record<string, string | null>): any {
  return {
    guildId: 'g',
    user: { id: 'u' },
    member: { roles: { cache: { has: (id: string) => id === 'admin' } } },
    options: {
      getSubcommand: () => 'create',
      getString: (name: string) => values[name] ?? null,
    },
    reply: async () => undefined,
  };
}

function repository(): any {
  return {
    getOptOut: async () => undefined,
    createEvent: async (value: unknown) => value,
  };
}
