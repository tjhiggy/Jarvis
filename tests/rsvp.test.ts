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
});
