import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EngagementDeletionService } from '../src/engagement/deletion.js';
import { SQLiteEngagementRepository } from '../src/storage/engagement-sqlite.js';

describe('engagement owner data deletion', () => {
  it('deletes member profiles truthfully through the operational owner path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-profile-delete-'));
    const repository = new SQLiteEngagementRepository(
      join(directory, 'engagement.db'),
    );
    try {
      await repository.createMemberProfile({
        serverId: 'guild-1',
        userId: 'member-1',
        bio: 'Builder',
        interests: 'Games',
        visibility: 'visible',
        createdAt: new Date('2026-08-01T12:00:00Z'),
        updatedAt: new Date('2026-08-01T12:00:00Z'),
      });
      const service = new EngagementDeletionService({
        repository,
        gateway: { delete: async () => undefined },
      });

      await expect(
        service.deleteOwnerData('guild-1', 'member-1'),
      ).resolves.toEqual({ completed: 1, pending: 0 });
      await expect(
        repository.getMemberProfile('guild-1', 'member-1'),
      ).resolves.toBeUndefined();
      await expect(
        service.deleteOwnerData('guild-1', 'member-1'),
      ).resolves.toEqual({ completed: 0, pending: 0 });
    } finally {
      await repository.closeConnection();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('durably queues bot cards and deletes content rows only after card deletion', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'jarvis-engagement-delete-'),
    );
    const path = join(directory, 'engagement.db');
    let repository = new SQLiteEngagementRepository(path);
    const old = new Date('2026-08-01T12:00:00.000Z');
    try {
      await repository.createIntroduction({
        id: 'intro-1',
        guildId: 'guild-1',
        channelId: 'intro-channel',
        ownerUserId: 'member-1',
        displayName: 'Member',
        interests: 'Space',
        introduction: 'Hello',
        status: 'active',
        createdAt: old,
        updatedAt: old,
      });
      await repository.updateIntroductionMessageId(
        'guild-1',
        'intro-1',
        'intro-message',
      );
      await repository.createSuggestion({
        id: 'suggestion-1',
        guildId: 'guild-1',
        channelId: 'suggestion-channel',
        ownerUserId: 'member-1',
        title: 'Idea',
        description: 'Description',
        status: 'open',
        createdAt: old,
        updatedAt: old,
      });
      await repository.updateSuggestionMessageId(
        'guild-1',
        'suggestion-1',
        'suggestion-message',
      );
      await repository.createEvent({
        id: 'event-1',
        guildId: 'guild-1',
        channelId: 'event-channel',
        ownerUserId: 'member-1',
        title: 'Event',
        description: 'Description',
        scheduledAt: new Date('2026-08-02T12:00:00.000Z'),
        timezone: 'UTC',
        capacity: 5,
        status: 'completed',
        createdAt: old,
        updatedAt: old,
      });
      await repository.updateEventMessageId(
        'guild-1',
        'event-1',
        'event-message',
      );

      const failing = new EngagementDeletionService({
        repository,
        gateway: {
          delete: async () => {
            throw new Error('Discord unavailable');
          },
        },
      });
      await expect(
        failing.deleteOwnerData('guild-1', 'member-1'),
      ).resolves.toMatchObject({ completed: 0, pending: 3 });
      await repository.cleanup(new Date('2026-08-09T12:00:00.000Z'), 100);
      await expect(
        repository.getIntroduction('guild-1', 'intro-1'),
      ).resolves.toBeDefined();
      await expect(
        repository.getSuggestion('guild-1', 'suggestion-1'),
      ).resolves.toBeDefined();
      await expect(
        repository.getEvent('guild-1', 'event-1'),
      ).resolves.toBeDefined();

      await repository.closeConnection();
      repository = new SQLiteEngagementRepository(path);
      const observed: string[] = [];
      const retry = new EngagementDeletionService({
        repository,
        gateway: {
          delete: async (_channelId, messageId) => {
            if (messageId === 'intro-message')
              expect(
                await repository.getIntroduction('guild-1', 'intro-1'),
              ).toBeDefined();
            if (messageId === 'suggestion-message')
              expect(
                await repository.getSuggestion('guild-1', 'suggestion-1'),
              ).toBeDefined();
            if (messageId === 'event-message')
              expect(
                await repository.getEvent('guild-1', 'event-1'),
              ).toBeDefined();
            observed.push(messageId);
          },
        },
      });
      await expect(retry.cleanupPending(10)).resolves.toBe(3);
      expect(observed.sort()).toEqual([
        'event-message',
        'intro-message',
        'suggestion-message',
      ]);
      await expect(
        repository.getIntroduction('guild-1', 'intro-1'),
      ).resolves.toBeUndefined();
      await expect(
        repository.getSuggestion('guild-1', 'suggestion-1'),
      ).resolves.toBeUndefined();
      await expect(
        repository.getEvent('guild-1', 'event-1'),
      ).resolves.toBeUndefined();
    } finally {
      await repository.closeConnection();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('reports the target owner pending even when more than 100 other jobs sort first', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'jarvis-engagement-delete-scope-'),
    );
    const repository = new SQLiteEngagementRepository(
      join(directory, 'engagement.db'),
    );
    const old = new Date('2026-08-01T12:00:00.000Z');
    try {
      for (let index = 0; index < 101; index += 1) {
        const ownerUserId = `other-${String(index).padStart(3, '0')}`;
        const id = `other-intro-${String(index).padStart(3, '0')}`;
        await repository.createIntroduction({
          id,
          guildId: 'guild-1',
          channelId: 'intro-channel',
          ownerUserId,
          displayName: 'Other',
          interests: 'Space',
          introduction: 'Hello',
          status: 'active',
          createdAt: new Date(old.getTime() + index),
          updatedAt: old,
        });
        await repository.updateIntroductionMessageId(
          'guild-1',
          id,
          `other-message-${index}`,
        );
        await repository.deleteOwnerData('guild-1', ownerUserId);
      }
      await repository.createIntroduction({
        id: 'target-intro',
        guildId: 'guild-1',
        channelId: 'intro-channel',
        ownerUserId: 'target-owner',
        displayName: 'Target',
        interests: 'Space',
        introduction: 'Hello',
        status: 'active',
        createdAt: new Date(old.getTime() + 10_000),
        updatedAt: old,
      });
      await repository.updateIntroductionMessageId(
        'guild-1',
        'target-intro',
        'target-message',
      );

      const service = new EngagementDeletionService({
        repository,
        gateway: {
          delete: async () => {
            throw new Error('Discord unavailable');
          },
        },
      });

      await expect(
        service.deleteOwnerData('guild-1', 'target-owner'),
      ).resolves.toEqual({ completed: 0, pending: 1 });
    } finally {
      await repository.closeConnection();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
