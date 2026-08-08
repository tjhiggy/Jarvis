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
});
