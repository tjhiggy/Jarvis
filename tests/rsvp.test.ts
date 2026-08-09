import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SQLiteEngagementRepository } from '../src/storage/engagement-sqlite.js';
import { EventService } from '../src/engagement/events.js';

describe('event RSVP capacity', () => {
  it('atomically waitlists a second yes and promotes it when a seat opens', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-event-rsvp-'));
    const repository = new SQLiteEngagementRepository(
      join(directory, 'events.db'),
    );
    const service = new EventService({
      repository,
      createId: () => 'event-1',
      adminRoleIds: new Set(['admin']),
      now: () => new Date('2026-08-08T12:00:00.000Z'),
    });
    try {
      const event = await service.create({
        guildId: 'guild-1',
        channelId: 'events',
        ownerUserId: 'owner',
        ownerRoleIds: new Set(['admin']),
        title: 'Raid',
        description: 'Boarding party',
        start: '2026-08-09 15:00',
        timezone: 'America/New_York',
        capacity: 1,
      });
      const [first, second] = await Promise.all([
        service.rsvp({
          guildId: 'guild-1',
          eventId: event.id,
          userId: 'one',
          response: 'yes',
          interactionId: 'click-1',
        }),
        service.rsvp({
          guildId: 'guild-1',
          eventId: event.id,
          userId: 'two',
          response: 'yes',
          interactionId: 'click-2',
        }),
      ]);
      expect([first.attendance, second.attendance].sort()).toEqual([
        'confirmed',
        'waitlisted',
      ]);
      const beforeRelease = await service.details('guild-1', event.id);
      const waitlisted = beforeRelease.rsvps.find(
        (rsvp) => rsvp.attendance === 'waitlisted',
      )!.userId;
      const confirmed = beforeRelease.rsvps.find(
        (rsvp) => rsvp.attendance === 'confirmed',
      )!.userId;
      await service.rsvp({
        guildId: 'guild-1',
        eventId: event.id,
        userId: confirmed,
        response: 'no',
        interactionId: 'click-3',
      });
      expect((await service.details('guild-1', event.id)).rsvps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            userId: waitlisted,
            response: 'yes',
            attendance: 'confirmed',
          }),
        ]),
      );
    } finally {
      await repository.closeConnection();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('round-trips an optional event end timestamp through SQLite', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-event-end-'));
    const path = join(directory, 'events.db');
    const repository = new SQLiteEngagementRepository(path);
    let reopened: SQLiteEngagementRepository | undefined;
    try {
      await repository.createEvent({
        id: 'event-end',
        guildId: 'guild-1',
        channelId: 'events',
        ownerUserId: 'owner',
        title: 'Shift',
        description: 'Two hour shift',
        scheduledAt: new Date('2026-08-09T19:00:00Z'),
        endsAt: new Date('2026-08-09T21:00:00Z'),
        timezone: 'America/New_York',
        capacity: 3,
        status: 'scheduled',
        createdAt: new Date('2026-08-08T12:00:00Z'),
        updatedAt: new Date('2026-08-08T12:00:00Z'),
      });
      await repository.closeConnection();
      reopened = new SQLiteEngagementRepository(path);
      await expect(
        reopened.getEvent('guild-1', 'event-end'),
      ).resolves.toMatchObject({ endsAt: new Date('2026-08-09T21:00:00Z') });
    } finally {
      await reopened?.closeConnection();
      await repository.closeConnection();
      await rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50,
      });
    }
  });

  it('atomically closes a due event at its end time and rejects a racing RSVP', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-event-close-'));
    const repository = new SQLiteEngagementRepository(
      join(directory, 'events.db'),
    );
    let now = new Date('2026-08-09T20:59:59.000Z');
    const service = new EventService({
      repository,
      createId: () => 'event-close',
      adminRoleIds: new Set(['admin']),
      now: () => now,
    });
    try {
      await repository.createEvent({
        id: 'event-close',
        guildId: 'guild-1',
        channelId: 'events',
        ownerUserId: 'owner',
        title: 'Shift',
        description: 'Two hour shift',
        scheduledAt: new Date('2026-08-09T19:00:00.000Z'),
        endsAt: new Date('2026-08-09T21:00:00.000Z'),
        timezone: 'UTC',
        capacity: 3,
        status: 'scheduled',
        createdAt: new Date('2026-08-08T12:00:00.000Z'),
        updatedAt: new Date('2026-08-08T12:00:00.000Z'),
      });
      now = new Date('2026-08-09T21:00:00.000Z');

      await expect(
        service.rsvp({
          guildId: 'guild-1',
          eventId: 'event-close',
          userId: 'member',
          response: 'yes',
          interactionId: 'late-click',
        }),
      ).rejects.toMatchObject({ code: 'closed' });
      await expect(
        repository.getEvent('guild-1', 'event-close'),
      ).resolves.toMatchObject({
        status: 'completed',
        updatedAt: now,
      });
      await expect(
        repository.cleanup(new Date('2026-08-10T00:00:00.000Z'), 10),
      ).resolves.toBeGreaterThan(0);
      await expect(
        repository.getEvent('guild-1', 'event-close'),
      ).resolves.toBeUndefined();
    } finally {
      await repository.closeConnection();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
