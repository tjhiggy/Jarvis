import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SQLiteEngagementRepository } from '../src/storage/engagement-sqlite.js';

describe('configuration audit log', () => {
  it('records bounded metadata and isolates servers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-config-audit-'));
    const repository = new SQLiteEngagementRepository(join(directory, 'db.sqlite'));
    try {
      const createdAt = new Date('2026-08-09T12:00:00.000Z');
      await repository.recordConfigurationAudit!({ guildId: 'ship-1', actorUserId: 'admin-1', operation: 'feature_flag_set', target: 'trivia', enabled: false, createdAt });
      await repository.recordConfigurationAudit!({ guildId: 'ship-2', actorUserId: 'admin-2', operation: 'proactive_state_set', target: 'paused', createdAt });
      expect(await repository.configurationAudit!('ship-1', 10)).toEqual([{ guildId: 'ship-1', actorUserId: 'admin-1', operation: 'feature_flag_set', target: 'trivia', enabled: false, createdAt }]);
    } finally { await repository.closeConnection(); await rm(directory, { recursive: true, force: true }); }
  });

  it('audits feature flag changes without storing secrets or content', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-config-audit-flags-'));
    const repository = new SQLiteEngagementRepository(join(directory, 'db.sqlite'));
    try {
      await repository.setFeatureFlag!('ship-1', 'events', false);
      const entries = await repository.configurationAudit!('ship-1', 10);
      expect(entries[0]).toMatchObject({ operation: 'feature_flag_set', target: 'events', enabled: false, actorUserId: 'system' });
      expect(JSON.stringify(entries)).not.toContain('secret');
    } finally { await repository.closeConnection(); await rm(directory, { recursive: true, force: true }); }
  });

  it('enforces a bounded read limit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-config-audit-limit-'));
    const repository = new SQLiteEngagementRepository(join(directory, 'db.sqlite'));
    try { await expect(repository.configurationAudit!('ship-1', 101)).rejects.toThrow('between 1 and 100'); }
    finally { await repository.closeConnection(); await rm(directory, { recursive: true, force: true }); }
  });
});
