import { describe, expect, it } from 'vitest';
import {
  MemberProfileService,
  type MemberProfile,
  type MemberProfileRepository,
} from '../src/engagement/member-profiles.js';

describe('MemberProfileService', () => {
  it('creates nothing until the owner confirms a bounded private draft', async () => {
    const repository = new MemoryProfiles();
    const service = createService(repository);
    const draft = await service.previewCreate({
      serverId: 'ship-1',
      ownerUserId: 'user-1',
      bio: '  Crew builder  ',
      interests: '',
    });

    await expect(repository.get('ship-1', 'user-1')).resolves.toBeUndefined();
    expect(draft.bio).toBe('Crew builder');
    expect(draft.interests).toBe('Gaming');
    expect(draft.interestsSuggested).toBe(true);

    const created = await service.confirm({
      serverId: 'ship-1',
      ownerUserId: 'user-1',
      draftId: draft.id,
    });
    expect(created?.visibility).toBe('visible');
    await expect(repository.get('ship-1', 'user-1')).resolves.toMatchObject({
      bio: 'Crew builder',
      interests: 'Gaming',
    });
  });

  it('rejects unsafe or excessive profile content', async () => {
    const service = createService(new MemoryProfiles());
    await expect(
      service.previewCreate(input({ bio: '@everyone report aboard' })),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(
      service.previewCreate(input({ interests: '<@&123456789012345678>' })),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(
      service.previewCreate(input({ bio: 'x'.repeat(501) })),
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('expires, caps, cancels, and owner-binds drafts', async () => {
    let now = new Date('2026-08-10T12:00:00Z');
    const repository = new MemoryProfiles();
    const service = createService(repository, () => now, 1);
    const draft = await service.previewCreate(input());
    await expect(
      service.previewCreate(input({ bio: 'second' })),
    ).rejects.toMatchObject({
      code: 'draft-limit',
    });
    await expect(
      service.confirm({
        serverId: 'ship-1',
        ownerUserId: 'other',
        draftId: draft.id,
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect(
      service.cancel({
        serverId: 'ship-1',
        ownerUserId: 'user-1',
        draftId: draft.id,
      }),
    ).toBe(true);
    const expiring = await service.previewCreate(input());
    now = new Date(now.getTime() + 15 * 60_000 + 1);
    await expect(
      service.confirm({
        serverId: 'ship-1',
        ownerUserId: 'user-1',
        draftId: expiring.id,
      }),
    ).rejects.toMatchObject({ code: 'expired' });
  });

  it('edits the complete profile and controls visibility', async () => {
    const repository = new MemoryProfiles();
    const service = createService(repository);
    const create = await service.previewCreate(input());
    await service.confirm({
      serverId: 'ship-1',
      ownerUserId: 'user-1',
      draftId: create.id,
    });
    const edit = await service.previewEdit(
      input({ bio: 'Updated', interests: 'Co-op' }),
    );
    await service.confirm({
      serverId: 'ship-1',
      ownerUserId: 'user-1',
      draftId: edit.id,
    });
    await expect(service.hide('ship-1', 'user-1')).resolves.toBe(true);
    await expect(repository.get('ship-1', 'user-1')).resolves.toMatchObject({
      bio: 'Updated',
      interests: 'Co-op',
      visibility: 'hidden',
    });
    await expect(service.show('ship-1', 'user-1')).resolves.toBe(true);
  });

  it('preserves profile fields omitted from an edit preview', async () => {
    const repository = new MemoryProfiles();
    const service = createService(repository);
    const create = await service.previewCreate(input());
    await service.confirm({
      serverId: 'ship-1',
      ownerUserId: 'user-1',
      draftId: create.id,
    });

    const edit = await service.previewEdit({
      serverId: 'ship-1',
      ownerUserId: 'user-1',
      bio: 'Updated',
      interests: null,
    });

    expect(edit).toMatchObject({ bio: 'Updated', interests: 'Games' });
  });

  it('uses a destructive draft and deletes only after confirmation', async () => {
    const repository = new MemoryProfiles();
    const service = createService(repository);
    const create = await service.previewCreate(input());
    await service.confirm({
      serverId: 'ship-1',
      ownerUserId: 'user-1',
      draftId: create.id,
    });
    const deletion = await service.previewDelete('ship-1', 'user-1');
    expect(await repository.get('ship-1', 'user-1')).toBeDefined();
    await expect(
      service.confirm({
        serverId: 'ship-1',
        ownerUserId: 'user-1',
        draftId: deletion.id,
      }),
    ).resolves.toBeNull();
    expect(await repository.get('ship-1', 'user-1')).toBeUndefined();
  });
});

const input = (
  overrides: Partial<{ bio: string; interests: string }> = {},
) => ({
  serverId: 'ship-1',
  ownerUserId: 'user-1',
  bio: 'Builder',
  interests: 'Games',
  ...overrides,
});

const createService = (
  repository: MemoryProfiles,
  now: () => Date = () => new Date('2026-08-10T12:00:00Z'),
  maxDraftsPerOwner = 3,
) =>
  new MemberProfileService({
    repository,
    introductionReader: { getSuggestedInterests: async () => 'Gaming' },
    createId: (() => {
      let id = 0;
      return () => `draft-${++id}`;
    })(),
    now,
    maxDraftsPerOwner,
  });

class MemoryProfiles implements MemberProfileRepository {
  private readonly values = new Map<string, MemberProfile>();
  async get(serverId: string, userId: string) {
    return this.values.get(`${serverId}:${userId}`);
  }
  async create(profile: MemberProfile) {
    const key = `${profile.serverId}:${profile.userId}`;
    if (this.values.has(key)) return 'duplicate' as const;
    this.values.set(key, profile);
    return 'created' as const;
  }
  async update(
    serverId: string,
    userId: string,
    values: Pick<MemberProfile, 'bio' | 'interests' | 'updatedAt'>,
  ) {
    const current = await this.get(serverId, userId);
    if (!current) return false;
    this.values.set(`${serverId}:${userId}`, { ...current, ...values });
    return true;
  }
  async setVisibility(
    serverId: string,
    userId: string,
    visibility: MemberProfile['visibility'],
    updatedAt: Date,
  ) {
    const current = await this.get(serverId, userId);
    if (!current) return false;
    this.values.set(`${serverId}:${userId}`, {
      ...current,
      visibility,
      updatedAt,
    });
    return true;
  }
  async delete(serverId: string, userId: string) {
    return this.values.delete(`${serverId}:${userId}`);
  }
}
