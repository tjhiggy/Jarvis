import { describe, expect, it, vi } from 'vitest';
import { createCommandDefinitions } from '../src/commands/definitions.js';
import { handleEventCommand } from '../src/commands/event.js';
import {
  handleCommand,
  type CommandDependencies,
  type ReplyPayload,
} from '../src/commands/handlers.js';
import type { Event, Rsvp } from '../src/engagement/domain.js';
import { EventService, EventServiceError } from '../src/engagement/events.js';
import {
  EngagementEventClosedError,
  EngagementOptOutError,
} from '../src/engagement/storage.js';

const safeMentions = { parse: [], repliedUser: false };
const now = new Date('2026-08-08T12:00:00.000Z');

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

  it('forwards an optional end time and a positive capacity override', async () => {
    const captured: Record<string, unknown> = {};
    const interaction = commandInteraction({
      title: 'Night watch',
      description: 'Two hour shift.',
      start: '2026-08-09 15:30',
      end: '2026-08-09 17:30',
      capacity: '8',
    });
    await handleEventCommand(interaction, {
      enabled: true,
      channelId: 'events',
      adminRoleIds: new Set(['admin']),
      service: {
        create: async (input: Record<string, unknown>) => {
          Object.assign(captured, input);
          return { id: 'event-2' };
        },
      } as any,
    });
    expect(captured).toMatchObject({
      end: '2026-08-09 17:30',
      capacity: 8,
    });
  });

  it('converts an unambiguous zoned wall time to UTC and retains the zone label', async () => {
    const service = new EventService({
      repository: repository(),
      createId: () => 'event-1',
      adminRoleIds: new Set(['admin']),
      now: () => now,
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
      now: () => now,
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

  it('rejects a spring-forward gap, an invalid timezone, and a past start', async () => {
    const service = new EventService({
      repository: repository(),
      createId: () => 'event-1',
      adminRoleIds: new Set(['admin']),
      now: () => now,
    });
    await expect(
      service.create(createInput({ start: '2026-03-08 02:30' })),
    ).rejects.toMatchObject({
      code: 'invalid-time',
    } satisfies Partial<EventServiceError>);
    await expect(
      service.create(createInput({ timezone: 'Not/AZone' })),
    ).rejects.toMatchObject({
      code: 'invalid-time',
    } satisfies Partial<EventServiceError>);
    await expect(
      service.create(createInput({ start: '2026-08-08 07:59' })),
    ).rejects.toMatchObject({
      code: 'past-time',
    } satisfies Partial<EventServiceError>);
    await expect(
      service.create(
        createInput({
          start: '2026-08-09 15:30',
          end: '2026-08-09 15:00',
        }),
      ),
    ).rejects.toMatchObject({
      code: 'past-time',
    } satisfies Partial<EventServiceError>);
  });

  it('rejects mass mentions, links, blank titles, and non-positive capacity', async () => {
    const service = new EventService({
      repository: repository(),
      createId: () => 'event-1',
      adminRoleIds: new Set(['admin']),
      now: () => now,
    });
    await expect(
      service.create(createInput({ title: '@everyone raid' })),
    ).rejects.toMatchObject({
      code: 'invalid-input',
    } satisfies Partial<EventServiceError>);
    await expect(
      service.create(createInput({ description: 'See https://example.test' })),
    ).rejects.toMatchObject({
      code: 'invalid-input',
    } satisfies Partial<EventServiceError>);
    await expect(
      service.create(createInput({ title: '   ' })),
    ).rejects.toMatchObject({
      code: 'invalid-input',
    } satisfies Partial<EventServiceError>);
    await expect(
      service.create(createInput({ capacity: 0 })),
    ).rejects.toMatchObject({
      code: 'invalid-input',
    } satisfies Partial<EventServiceError>);
  });

  it('keeps a created event when the RSVP card post fails and records the destination miss', async () => {
    const missed: unknown[][] = [];
    const service = new EventService({
      repository: {
        ...repository(),
        markEventDestinationMissed: async (...args: unknown[]) => {
          missed.push(args);
        },
        updateEventMessageId: async () => {
          throw new Error('must not persist a Discord message id');
        },
      },
      createId: () => 'event-1',
      adminRoleIds: new Set(['admin']),
      gateway: {
        post: async () => {
          throw new Error('Missing Access');
        },
      },
      now: () => now,
    });
    await expect(service.create(createInput())).resolves.toMatchObject({
      id: 'event-1',
      title: 'Launch',
    });
    expect(missed).toEqual([['g', 'event-1', now]]);
  });
});

describe('event command fail-closed edges', () => {
  it('registers administrator create/cancel and public list/details subcommands', () => {
    const command = createCommandDefinitions(2_000, [
      {
        id: 'capabilities',
        label: 'Capabilities',
        question: 'What can Jarvis do?',
        answer: 'Synthetic answer.',
      },
    ]).find((definition) => definition.name === 'event');

    expect(command?.options?.map((option) => option.name)).toEqual([
      'create',
      'list',
      'details',
      'cancel',
    ]);
  });

  it('fails closed from a DM or blank guild without calling the service', async () => {
    const service = {
      create: vi.fn(),
      list: vi.fn(),
      details: vi.fn(),
      cancel: vi.fn(),
    };
    for (const guildId of [null, '   ']) {
      const interaction = commandInteraction(
        { title: 'Launch', description: 'Ready', start: '2026-08-09 15:30' },
        { guildId },
      );
      await handleEventCommand(interaction, {
        enabled: true,
        channelId: 'events',
        adminRoleIds: new Set(['admin']),
        service: service as any,
      });
      expect(interaction.replies[0]).toMatchObject({
        ephemeral: true,
        allowedMentions: safeMentions,
        content: expect.stringMatching(/server channel/i),
      });
    }
    expect(service.create).not.toHaveBeenCalled();
    expect(service.list).not.toHaveBeenCalled();
  });

  it.each([
    { enabled: false, channelId: 'events', service: { list: vi.fn() } },
    { enabled: true, channelId: '   ', service: { list: vi.fn() } },
    { enabled: true, channelId: 'events' },
  ])(
    'reports unconfigured events without calling create or list',
    async (dependencies) => {
      const interaction = commandInteraction({}, { sub: 'list' });
      await handleEventCommand(interaction, {
        adminRoleIds: new Set(['admin']),
        ...dependencies,
      } as any);
      expect(interaction.replies[0]).toMatchObject({
        ephemeral: true,
        allowedMentions: safeMentions,
        content: expect.stringMatching(/not configured/i),
      });
      const list = (
        dependencies as { service?: { list?: ReturnType<typeof vi.fn> } }
      ).service?.list;
      if (list !== undefined) expect(list).not.toHaveBeenCalled();
    },
  );

  it('lets any member list upcoming events and reports an empty schedule', async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        scheduledEvent({ id: 'event-2', title: 'Boarding drill' }),
      ]);
    const empty = commandInteraction({}, { sub: 'list', admin: false });
    await handleEventCommand(empty, {
      enabled: true,
      channelId: 'events',
      adminRoleIds: new Set(['admin']),
      service: { list } as any,
    });
    expect(empty.replies[0]).toMatchObject({
      ephemeral: true,
      allowedMentions: safeMentions,
      content: 'No upcoming events are scheduled.',
    });

    const populated = commandInteraction({}, { sub: 'list', admin: false });
    await handleEventCommand(populated, {
      enabled: true,
      channelId: 'events',
      adminRoleIds: new Set(['admin']),
      service: { list } as any,
    });
    expect(populated.replies[0]).toMatchObject({
      ephemeral: true,
      content: expect.stringMatching(
        /event-2: Boarding drill at 2026-08-09T19:30:00.000Z \(America\/New_York\)/,
      ),
    });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('reports confirmed and waitlisted RSVP totals', async () => {
    const interaction = commandInteraction(
      { id: 'event-1' },
      { sub: 'details' },
    );
    await handleEventCommand(interaction, {
      enabled: true,
      channelId: 'events',
      adminRoleIds: new Set(['admin']),
      service: {
        details: async () => ({
          event: scheduledEvent({ capacity: 4 }),
          rsvps: [
            rsvp({ userId: 'one', attendance: 'confirmed' }),
            rsvp({ userId: 'two', attendance: 'waitlisted' }),
            rsvp({ userId: 'three', attendance: 'none', response: 'maybe' }),
          ],
        }),
      } as any,
    });
    expect(interaction.replies[0]).toMatchObject({
      ephemeral: true,
      allowedMentions: safeMentions,
      content: 'Launch: 1/4 confirmed, 1 waitlisted.',
    });
  });

  it('maps not-found details without leaking the service error', async () => {
    const interaction = commandInteraction(
      { id: 'missing' },
      { sub: 'details' },
    );
    await handleEventCommand(interaction, {
      enabled: true,
      channelId: 'events',
      adminRoleIds: new Set(['admin']),
      service: {
        details: async () => {
          throw new EventServiceError('not-found');
        },
      } as any,
    });
    expect(interaction.replies[0]).toMatchObject({
      ephemeral: true,
      allowedMentions: safeMentions,
      content: 'That event was not found.',
    });
    expect(interaction.replies[0]?.content).not.toMatch(
      /not-found|Error|stack/i,
    );
  });

  it('cancels as an administrator and blocks a non-admin cancel', async () => {
    const cancel = vi.fn(async () => scheduledEvent({ status: 'cancelled' }));
    const admin = commandInteraction({ id: 'event-1' }, { sub: 'cancel' });
    await handleEventCommand(admin, {
      enabled: true,
      channelId: 'events',
      adminRoleIds: new Set(['admin']),
      service: { cancel } as any,
    });
    expect(cancel).toHaveBeenCalledWith({
      guildId: 'g',
      eventId: 'event-1',
      actorRoleIds: new Set(['admin']),
    });
    expect(admin.replies[0]).toMatchObject({
      ephemeral: true,
      content: 'Event event-1 was cancelled.',
    });

    const forbidden = commandInteraction(
      { id: 'event-1' },
      { sub: 'cancel', admin: false },
    );
    await handleEventCommand(forbidden, {
      enabled: true,
      channelId: 'events',
      adminRoleIds: new Set(['admin']),
      service: {
        cancel: async () => {
          throw new EventServiceError('forbidden');
        },
      } as any,
    });
    expect(forbidden.replies[0]).toMatchObject({
      ephemeral: true,
      content: expect.stringMatching(
        /restricted to configured MuthaShip administrators/i,
      ),
    });
  });

  it('maps invalid-time, past-time, and generic failures without leaking internals', async () => {
    const cases: Array<{
      code?: EventServiceError['code'] | 'raw';
      expected: RegExp;
    }> = [
      {
        code: 'invalid-time',
        expected: /unambiguous YYYY-MM-DD HH:mm/i,
      },
      {
        code: 'past-time',
        expected: /must be in the future/i,
      },
      {
        code: 'invalid-input',
        expected: /could not be completed/i,
      },
      { code: 'opted-out', expected: /could not be completed/i },
      { code: 'raw', expected: /could not be completed/i },
    ];
    for (const { code, expected } of cases) {
      const interaction = commandInteraction({
        title: 'Launch',
        description: 'Ready',
        start: '2026-08-09 15:30',
      });
      await handleEventCommand(interaction, {
        enabled: true,
        channelId: 'events',
        adminRoleIds: new Set(['admin']),
        service: {
          create: async () => {
            if (code === 'raw' || code === undefined)
              throw new Error('SQLITE_ERROR: secret schema');
            throw new EventServiceError(code);
          },
        } as any,
      });
      expect(interaction.replies[0]).toMatchObject({
        ephemeral: true,
        allowedMentions: safeMentions,
        content: expect.stringMatching(expected),
      });
      expect(interaction.replies[0]?.content).not.toMatch(
        /SQLITE|secret schema|invalid-input|opted-out/i,
      );
    }
  });

  it('forwards a non-numeric capacity as NaN so the service can reject it', async () => {
    const create = vi.fn();
    const interaction = commandInteraction({
      title: 'Launch',
      description: 'Ready',
      start: '2026-08-09 15:30',
      capacity: 'none',
    });
    await handleEventCommand(interaction, {
      enabled: true,
      channelId: 'events',
      adminRoleIds: new Set(['admin']),
      service: {
        create: async (input: { capacity: number }) => {
          create(input);
          throw new EventServiceError('invalid-input');
        },
      } as any,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ capacity: Number.NaN }),
    );
    expect(interaction.replies[0]?.content).toMatch(/could not be completed/i);
  });

  it('routes /event list through handleCommand onto the event channel config', async () => {
    const list = vi.fn(async () => [scheduledEvent()]);
    const replies: ReplyPayload[] = [];
    await handleCommand(
      {
        id: 'interaction-1',
        commandName: 'event',
        guildId: 'guild-1',
        channelId: 'channel-1',
        channel: { parentId: null, isThread: () => false },
        user: { id: 'user-1' },
        member: {
          roles: { cache: { has: () => false } },
        },
        options: {
          getSubcommand: () => 'list',
          getString: () => null,
        },
        deferReply: async () => undefined,
        fetchReply: async () => ({ id: 'message-1' }),
        reply: async (payload) => {
          replies.push(payload);
        },
        editReply: async () => undefined,
        followUp: async () => undefined,
      },
      commandDependencies({ list } as any),
    );
    expect(list).toHaveBeenCalledWith('guild-1');
    expect(replies[0]).toMatchObject({
      ephemeral: true,
      allowedMentions: safeMentions,
      content: expect.stringContaining('event-1: Launch'),
    });
  });
});

describe('event service RSVP and cancel edges', () => {
  it('rejects RSVP for a missing, cancelled, or duplicate interaction', async () => {
    const event = scheduledEvent();
    const cancelled = scheduledEvent({ status: 'cancelled' });
    const claimed = new Set<string>();
    const service = new EventService({
      repository: {
        ...repository(),
        getEvent: async (_guildId: string, eventId: string) => {
          if (eventId === 'missing') return undefined;
          if (eventId === 'cancelled') return cancelled;
          return event;
        },
        claimIdempotencyKey: async (
          _guildId: string,
          _scope: string,
          key: string,
        ) => {
          if (claimed.has(key)) return false;
          claimed.add(key);
          return true;
        },
        respondToEvent: async (input: Rsvp) => input,
        listRsvps: async () => [],
      },
      createId: () => 'event-1',
      adminRoleIds: new Set(['admin']),
      now: () => now,
    });
    await expect(
      service.rsvp({
        guildId: 'g',
        eventId: 'missing',
        userId: 'member',
        response: 'yes',
        interactionId: 'click-1',
      }),
    ).rejects.toMatchObject({
      code: 'not-found',
    } satisfies Partial<EventServiceError>);
    await expect(
      service.rsvp({
        guildId: 'g',
        eventId: 'cancelled',
        userId: 'member',
        response: 'yes',
        interactionId: 'click-2',
      }),
    ).rejects.toMatchObject({
      code: 'cancelled',
    } satisfies Partial<EventServiceError>);
    await expect(
      service.rsvp({
        guildId: 'g',
        eventId: 'event-1',
        userId: 'member',
        response: 'yes',
        interactionId: 'click-3',
      }),
    ).resolves.toMatchObject({ userId: 'member', response: 'yes' });
    await expect(
      service.rsvp({
        guildId: 'g',
        eventId: 'event-1',
        userId: 'member',
        response: 'yes',
        interactionId: 'click-3',
      }),
    ).rejects.toMatchObject({
      code: 'duplicate-action',
    } satisfies Partial<EventServiceError>);
  });

  it('maps repository opt-out and closed errors on RSVP', async () => {
    const serviceFor = (error: Error) =>
      new EventService({
        repository: {
          ...repository(),
          getEvent: async () => scheduledEvent(),
          claimIdempotencyKey: async () => true,
          respondToEvent: async () => {
            throw error;
          },
        },
        createId: () => 'event-1',
        adminRoleIds: new Set(['admin']),
        now: () => now,
      });
    await expect(
      serviceFor(new EngagementOptOutError()).rsvp({
        guildId: 'g',
        eventId: 'event-1',
        userId: 'member',
        response: 'yes',
        interactionId: 'click-4',
      }),
    ).rejects.toMatchObject({
      code: 'opted-out',
    } satisfies Partial<EventServiceError>);
    await expect(
      serviceFor(new EngagementEventClosedError()).rsvp({
        guildId: 'g',
        eventId: 'event-1',
        userId: 'member',
        response: 'yes',
        interactionId: 'click-5',
      }),
    ).rejects.toMatchObject({
      code: 'closed',
    } satisfies Partial<EventServiceError>);
  });

  it('forbids a non-admin cancel and reports a missing event', async () => {
    const service = new EventService({
      repository: {
        ...repository(),
        updateEventStatus: async (
          _guildId: string,
          eventId: string,
          status: Event['status'],
        ) =>
          eventId === 'event-1'
            ? scheduledEvent({ id: eventId, status })
            : undefined,
      },
      createId: () => 'event-1',
      adminRoleIds: new Set(['admin']),
      now: () => now,
    });
    await expect(
      service.cancel({
        guildId: 'g',
        eventId: 'event-1',
        actorRoleIds: new Set(),
      }),
    ).rejects.toMatchObject({
      code: 'forbidden',
    } satisfies Partial<EventServiceError>);
    await expect(
      service.cancel({
        guildId: 'g',
        eventId: 'missing',
        actorRoleIds: new Set(['admin']),
      }),
    ).rejects.toMatchObject({
      code: 'not-found',
    } satisfies Partial<EventServiceError>);
    await expect(
      service.cancel({
        guildId: 'g',
        eventId: 'event-1',
        actorRoleIds: new Set(['admin']),
      }),
    ).resolves.toMatchObject({ id: 'event-1', status: 'cancelled' });
  });
});

function commandInteraction(
  values: Record<string, string | null>,
  extras: {
    guildId?: string | null;
    sub?: string;
    admin?: boolean;
  } = {},
): any {
  const replies: any[] = [];
  return {
    guildId: extras.guildId === undefined ? 'g' : extras.guildId,
    user: { id: 'u' },
    member: {
      roles: {
        cache: {
          has: (id: string) => (extras.admin ?? true) && id === 'admin',
        },
      },
    },
    options: {
      getSubcommand: () => extras.sub ?? 'create',
      getString: (name: string) => values[name] ?? null,
    },
    replies,
    reply: async (value: any) => {
      replies.push(value);
    },
  };
}

function repository(): any {
  return {
    getOptOut: async () => undefined,
    createEvent: async (value: unknown) => value,
    getEvent: async () => undefined,
    listEvents: async () => [],
    listRsvps: async () => [],
    updateEventStatus: async () => undefined,
    claimIdempotencyKey: async () => true,
    respondToEvent: async (value: unknown) => value,
  };
}

function createInput(
  overrides: Partial<{
    title: string;
    description: string;
    start: string;
    timezone: string;
    capacity: number;
    end: string;
  }> = {},
) {
  return {
    guildId: 'g',
    channelId: 'c',
    ownerUserId: 'u',
    ownerRoleIds: new Set(['admin']),
    title: 'Launch',
    description: 'Ready',
    start: '2026-08-09 15:30',
    timezone: 'America/New_York',
    capacity: 4,
    ...overrides,
  };
}

function scheduledEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'event-1',
    guildId: 'g',
    channelId: 'c',
    ownerUserId: 'u',
    title: 'Launch',
    description: 'Ready',
    scheduledAt: new Date('2026-08-09T19:30:00.000Z'),
    timezone: 'America/New_York',
    capacity: 4,
    status: 'scheduled',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function rsvp(overrides: Partial<Rsvp> = {}): Rsvp {
  return {
    eventId: 'event-1',
    guildId: 'g',
    userId: 'member',
    response: 'yes',
    attendance: 'confirmed',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function commandDependencies(
  eventService: NonNullable<CommandDependencies['eventService']>,
): CommandDependencies {
  return {
    config: {
      discord: {
        token: 'discord-token',
        clientId: 'client-1',
        guildId: 'guild-1',
      },
      openai: { apiKey: 'openai-key' },
      ai: { provider: 'ollama' },
      ollama: { baseUrl: 'http://127.0.0.1:11434', model: 'qwen3:8b' },
      webSearch: { apiKey: 'tvly-secret' },
      security: { allowedChannelIds: new Set<string>(), maxInputChars: 100 },
      engagement: {
        enabled: true,
        channels: {
          introductionId: '',
          suggestionId: '',
          eventId: 'events',
          recapId: '',
          activityId: '',
          birthdayId: '',
          rssId: '',
        },
        rssAllowedHosts: [],
        recapSchedule: '',
        retentionDays: 30,
        adminRoleIds: new Set(['admin']),
      },
    },
    conversationService: {
      ask: async () => ({ status: 'success', text: 'unused' }),
      clear: async () => 0,
    },
    store: { healthCheck: async () => true },
    reminderService: {
      set: async () => {
        throw new Error('/event must not call reminderService.set');
      },
      list: async () => [],
      cancel: async () => undefined,
    },
    reminderHealth: {
      store: {
        healthCheck: async () => true,
        statusCounts: async () => ({
          pending: 0,
          retryPending: 0,
          deliveryUncertain: 0,
          failed: 0,
        }),
      },
      scheduler: { healthy: true },
    },
    faq: { entries: [], get: () => undefined },
    eventService,
  };
}
