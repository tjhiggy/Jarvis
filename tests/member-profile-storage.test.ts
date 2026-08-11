import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SQLiteEngagementRepository } from '../src/storage/engagement-sqlite.js';
import type { MemberProfile } from '../src/engagement/member-profiles.js';

describe('SQLite member profiles', () => {
  let directory: string;
  let databasePath: string;
  let repository: SQLiteEngagementRepository;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'jarvis-profiles-'));
    databasePath = join(directory, 'profiles.db');
    repository = new SQLiteEngagementRepository(databasePath);
  });
  afterEach(async () => {
    await repository.closeConnection();
    await rm(directory, { recursive: true, force: true });
  });

  it('persists profile lifecycle across reopen', async () => {
    const profile = value();
    await expect(repository.createMemberProfile(profile)).resolves.toBe(
      'created',
    );
    await expect(repository.createMemberProfile(profile)).resolves.toBe(
      'duplicate',
    );
    await repository.closeConnection();
    repository = new SQLiteEngagementRepository(databasePath);
    await expect(
      repository.getMemberProfile('ship-1', 'member-1'),
    ).resolves.toMatchObject({
      bio: 'Builder',
      visibility: 'visible',
    });
    await expect(
      repository.updateMemberProfile('ship-1', 'member-1', {
        bio: 'Updated',
        interests: null,
        updatedAt: new Date('2026-08-10T13:00:00Z'),
      }),
    ).resolves.toBe(true);
    await expect(
      repository.setMemberProfileVisibility(
        'ship-1',
        'member-1',
        'hidden',
        new Date('2026-08-10T14:00:00Z'),
      ),
    ).resolves.toBe(true);
    await expect(
      repository.getMemberProfile('ship-1', 'member-1'),
    ).resolves.toMatchObject({
      bio: 'Updated',
      interests: null,
      visibility: 'hidden',
    });
  });

  it('isolates the same member between MuthaShips and scopes owner deletion', async () => {
    await repository.createMemberProfile(value());
    await repository.createMemberProfile(
      value({ serverId: 'ship-2', bio: 'Other ship' }),
    );
    await expect(
      repository.deleteOwnerData('ship-1', 'member-1'),
    ).resolves.toBe(1);
    await expect(
      repository.getMemberProfile('ship-1', 'member-1'),
    ).resolves.toBeUndefined();
    await expect(
      repository.getMemberProfile('ship-2', 'member-1'),
    ).resolves.toMatchObject({
      bio: 'Other ship',
    });
  });

  it('does not delete durable profiles during generic retention cleanup', async () => {
    await repository.createMemberProfile(value());
    await repository.cleanup(new Date('2030-01-01T00:00:00Z'), 100);
    await expect(
      repository.getMemberProfile('ship-1', 'member-1'),
    ).resolves.toBeDefined();
  });
});

const value = (overrides: Partial<MemberProfile> = {}): MemberProfile => ({
  serverId: 'ship-1',
  userId: 'member-1',
  bio: 'Builder',
  interests: 'Games',
  visibility: 'visible',
  createdAt: new Date('2026-08-10T12:00:00Z'),
  updatedAt: new Date('2026-08-10T12:00:00Z'),
  ...overrides,
});
