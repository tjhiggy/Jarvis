import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SQLiteEngagementRepository } from '../src/storage/engagement-sqlite.js';

describe('engagement operational cleanup', () => {
  it('persists an admin pause across restart and records metadata-only audit entries', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-engagement-ops-'));
    const path = join(directory, 'engagement.db');
    let repository = new SQLiteEngagementRepository(path);
    try {
      const at = new Date('2026-08-08T12:00:00.000Z');
      await repository.setEngagementPaused('guild-1', true, 'admin-1', at);
      expect(await repository.engagementPaused('guild-1')).toBe(true);
      expect(await repository.operationalAudit('guild-1', 10)).toEqual([
        {
          guildId: 'guild-1',
          actorUserId: 'admin-1',
          operation: 'engagement_pause',
          createdAt: at,
        },
      ]);

      await repository.closeConnection();
      repository = new SQLiteEngagementRepository(path);
      expect(await repository.engagementPaused('guild-1')).toBe(true);
    } finally {
      await repository.closeConnection();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('returns only aggregate engagement counts for status diagnostics', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-engagement-counts-'));
    const repository = new SQLiteEngagementRepository(join(directory, 'engagement.db'));
    try {
      await repository.createSuggestion({
        id: 'suggestion-1', guildId: 'guild-1', channelId: 'channel-1', ownerUserId: 'user-1',
        title: 'Secret title', description: 'Secret suggestion text', status: 'open',
        createdAt: new Date('2026-08-08T12:00:00.000Z'), updatedAt: new Date('2026-08-08T12:00:00.000Z'),
      });
      const counts = await repository.statusCounts('guild-1');
      expect(counts).toEqual({ introductions: 0, suggestions: 1, events: 0, rsvps: 0, triviaRounds: 0 });
      expect(JSON.stringify(counts)).not.toContain('Secret');
    } finally {
      await repository.closeConnection();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('bounds operational records and cascades RSVPs when expired events are removed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-engagement-retention-'));
    const repository = new SQLiteEngagementRepository(join(directory, 'engagement.db'));
    try {
      const old = new Date('2026-08-01T12:00:00.000Z');
      const cutoff = new Date('2026-08-02T12:00:00.000Z');
      await repository.createEvent({
        id: 'expired-event', guildId: 'guild-1', channelId: 'channel-1',
        ownerUserId: 'admin-1', title: 'Old event', description: 'Expired.',
        scheduledAt: old, timezone: 'UTC', capacity: 10, status: 'completed',
        createdAt: old, updatedAt: old,
      });
      await repository.upsertRsvp({
        eventId: 'expired-event', guildId: 'guild-1', userId: 'member-1',
        response: 'yes', createdAt: old, updatedAt: old,
      });
      await repository.setRecapEnabled('guild-1', true, old);
      const lease = await repository.claimRecapRun('guild-1', 'weekly-recap:old', old);
      await repository.completeRecapRun('guild-1', 'weekly-recap:old', lease!, old);
      await repository.setEngagementPaused('guild-1', true, 'admin-1', old);

      await expect(repository.cleanup(cutoff, 20)).resolves.toBe(5);
      await expect(repository.statusCounts('guild-1')).resolves.toMatchObject({
        events: 0, rsvps: 0,
      });
      await expect(repository.recapEnabled('guild-1')).resolves.toBe(false);
      await expect(repository.engagementPaused('guild-1')).resolves.toBe(false);
      await expect(repository.operationalAudit('guild-1', 10)).resolves.toEqual([]);
      await expect(
        repository.claimRecapRun('guild-1', 'weekly-recap:old', cutoff),
      ).resolves.toBeDefined();
    } finally {
      await repository.closeConnection();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
