import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { IntroductionService } from '../src/engagement/introductions.js';
import type { EngagementRepository } from '../src/engagement/storage.js';
import { EngagementRecordConflictError } from '../src/engagement/storage.js';
import { RateLimiter } from '../src/security/rate-limiter.js';
import { SQLiteEngagementRepository } from '../src/storage/engagement-sqlite.js';

describe('IntroductionService', () => {
  it('keeps a preview private until its owner confirms and lets the owner cancel it', async () => {
    const repository = new MemoryRepository();
    const gateway = new Gateway();
    const service = createService(repository, gateway);
    const draft = await service.preview(introductionInput());
    expect(repository.introductions.size).toBe(0);
    expect(gateway.posts).toEqual([]);
    expect(
      service.cancel({
        guildId: 'guild-1',
        ownerUserId: 'user-1',
        draftId: draft.id,
      }),
    ).toBe(true);
    await expect(
      service.confirm({
        guildId: 'guild-1',
        ownerUserId: 'user-1',
        draftId: draft.id,
      }),
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('posts a bounded opted-in introduction only to the configured channel', async () => {
    const repository = new MemoryRepository();
    const gateway = new Gateway();
    const service = createService(repository, gateway);

    await expect(
      service.submit({
        guildId: 'guild-1',
        ownerUserId: 'user-1',
        channelId: 'configured-introductions',
        displayName: '  Ripley  ',
        interests: '  Space cats  ',
        introduction: '  Here for the crew.  ',
      }),
    ).resolves.toMatchObject({ id: 'intro-1', messageId: 'message-1' });

    expect(gateway.posts).toEqual([
      {
        channelId: 'configured-introductions',
        content: expect.stringContaining('Ripley'),
      },
    ]);
    expect(gateway.posts[0]?.content).not.toMatch(/@everyone|@here/);
  });

  it('rejects a missing configured channel, opt-out, duplicate active introduction, and rate limit', async () => {
    const repository = new MemoryRepository();
    const service = createService(repository, new Gateway());
    const input = introductionInput();

    await expect(
      service.submit({ ...input, channelId: '' }),
    ).rejects.toMatchObject({ code: 'missing-channel' });
    await repository.setOptOut({
      guildId: 'guild-1',
      userId: 'user-1',
      optedOutAt: new Date(),
    });
    await expect(service.submit(input)).rejects.toMatchObject({
      code: 'opted-out',
    });

    repository.optedOut.clear();
    await service.submit(input);
    await expect(service.submit(input)).rejects.toMatchObject({
      code: 'duplicate',
    });
    const limitedRepository = new MemoryRepository();
    const limitedService = createService(limitedRepository, new Gateway(), 1);
    await limitedService.submit(input);
    limitedRepository.introductions.get('guild-1:intro-1').status = 'deleted';
    await expect(limitedService.submit(input)).rejects.toMatchObject({
      code: 'rate-limit',
    });
  });

  it('lets only the owner delete an active introduction and removes its bot-owned card', async () => {
    const repository = new MemoryRepository();
    const gateway = new Gateway();
    const service = createService(repository, gateway);
    const created = await service.submit(introductionInput());

    await expect(
      service.delete({
        guildId: 'guild-1',
        ownerUserId: 'user-2',
        introductionId: created.id,
      }),
    ).resolves.toBe(false);
    await expect(
      service.delete({
        guildId: 'guild-1',
        ownerUserId: 'user-1',
        introductionId: created.id,
      }),
    ).resolves.toBe(true);
    expect(gateway.deletes).toEqual([
      { channelId: 'configured-introductions', messageId: 'message-1' },
    ]);
    await expect(
      repository.getIntroduction('guild-1', created.id),
    ).resolves.toMatchObject({ status: 'deleted' });
  });

  it('recovers duplicate protection after restart from persisted active records', async () => {
    const repository = new MemoryRepository();
    await createService(repository, new Gateway()).submit(introductionInput());

    await expect(
      createService(repository, new Gateway()).submit(introductionInput()),
    ).rejects.toMatchObject({ code: 'duplicate' });
  });

  it('allows only one concurrent confirmation for the same owner', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-introduction-'));
    const repository = new SQLiteEngagementRepository(
      join(directory, 'engagement.db'),
    );
    try {
      const service = createService(repository, new Gateway());
      const first = await service.preview(introductionInput());
      const second = await service.preview(introductionInput());
      const results = await Promise.allSettled([
        service.confirm({
          guildId: 'guild-1',
          ownerUserId: 'user-1',
          draftId: first.id,
        }),
        service.confirm({
          guildId: 'guild-1',
          ownerUserId: 'user-1',
          draftId: second.id,
        }),
      ]);
      expect(
        results.filter((result) => result.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === 'rejected'),
      ).toHaveLength(1);
    } finally {
      await repository.closeConnection();
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('deletes expired bot-owned cards before removing retained introductions', async () => {
    const repository = new MemoryRepository();
    const gateway = new Gateway();
    const service = createService(repository, gateway);
    const created = await service.submit(introductionInput());
    repository.introductions.get(`guild-1:${created.id}`).updatedAt = new Date(
      '2026-01-01T00:00:00.000Z',
    );
    await expect(
      service.cleanup(new Date('2026-08-01T00:00:00.000Z'), 10),
    ).resolves.toBe(1);
    expect(gateway.deletes).toContainEqual({
      channelId: 'configured-introductions',
      messageId: 'message-1',
    });
    await expect(
      repository.getIntroduction('guild-1', created.id),
    ).resolves.toBeUndefined();
  });

  it('retains cleanup-pending records when Discord cannot delete their cards', async () => {
    const repository = new MemoryRepository();
    const gateway = new Gateway();
    gateway.delete = async () => {
      throw new Error('Discord unavailable');
    };
    const service = createService(repository, gateway);
    const created = await service.submit(introductionInput());
    repository.introductions.get(`guild-1:${created.id}`).updatedAt = new Date(
      '2026-01-01T00:00:00.000Z',
    );
    await expect(
      service.cleanup(new Date('2026-08-01T00:00:00.000Z'), 10),
    ).resolves.toBe(0);
    expect(repository.introductions.get(`guild-1:${created.id}`)).toMatchObject(
      { status: 'cleanup_pending' },
    );
  });
});

function introductionInput() {
  return {
    guildId: 'guild-1',
    ownerUserId: 'user-1',
    channelId: 'configured-introductions',
    displayName: 'Ripley',
    interests: 'Space cats',
    introduction: 'Here for the crew.',
  };
}

function createService(
  repository: EngagementRepository,
  gateway: Gateway,
  capacity = 5,
) {
  let nextId = 1;
  return new IntroductionService({
    repository,
    gateway,
    rateLimiter: new RateLimiter(capacity, 60_000),
    createId: () => `intro-${nextId++}`,
    now: () => new Date('2026-08-08T12:00:00.000Z'),
  });
}

class Gateway {
  posts: Array<{ channelId: string; content: string }> = [];
  deletes: Array<{ channelId: string; messageId: string }> = [];
  async post(channelId: string, content: string) {
    this.posts.push({ channelId, content });
    return { id: 'message-1' };
  }
  delete = async (channelId: string, messageId: string) => {
    this.deletes.push({ channelId, messageId });
  };
}

class MemoryRepository implements EngagementRepository {
  introductions = new Map<string, any>();
  optedOut = new Map<string, any>();
  async createIntroduction(value: any) {
    if (
      [...this.introductions.values()].some(
        (existing) =>
          existing.guildId === value.guildId &&
          existing.ownerUserId === value.ownerUserId &&
          existing.status === 'active',
      )
    ) {
      throw new EngagementRecordConflictError(
        'Engagement record already exists.',
      );
    }
    this.introductions.set(`${value.guildId}:${value.id}`, { ...value });
    return value;
  }
  async getIntroduction(guildId: string, id: string) {
    return this.introductions.get(`${guildId}:${id}`);
  }
  async findActiveIntroductionByOwner(guildId: string, ownerUserId: string) {
    return [...this.introductions.values()].find(
      (value) =>
        value.guildId === guildId &&
        value.ownerUserId === ownerUserId &&
        value.status === 'active',
    );
  }
  async updateIntroductionMessageId(
    guildId: string,
    id: string,
    messageId: string,
  ) {
    const value = await this.getIntroduction(guildId, id);
    if (value !== undefined) {
      value.messageId = messageId;
      value.updatedAt = new Date();
    }
    return value;
  }
  async updateIntroductionStatus(
    guildId: string,
    ownerUserId: string,
    id: string,
    status: any,
    updatedAt: Date,
  ) {
    const value = await this.getIntroduction(guildId, id);
    if (value?.ownerUserId !== ownerUserId) return undefined;
    value.status = status;
    value.updatedAt = updatedAt;
    return value;
  }
  async listExpiredIntroductions(cutoff: Date, limit: number) {
    return [...this.introductions.values()]
      .filter(
        (value) =>
          value.status === 'cleanup_pending' ||
          (value.status === 'active' && value.updatedAt < cutoff),
      )
      .slice(0, limit);
  }
  async deleteIntroductionRecord(guildId: string, id: string) {
    return this.introductions.delete(`${guildId}:${id}`);
  }
  async getOptOut(guildId: string, userId: string) {
    return this.optedOut.get(`${guildId}:${userId}`);
  }
  async setOptOut(value: any) {
    this.optedOut.set(`${value.guildId}:${value.userId}`, value);
    return value;
  }
  async createSuggestion(): Promise<any> {
    throw new Error('unused');
  }
  async getSuggestion(): Promise<any> {
    return undefined;
  }
  async findActiveSuggestionByContent(): Promise<any> {
    return undefined;
  }
  async updateSuggestionStatus(): Promise<any> {
    return undefined;
  }
  async createEvent(): Promise<any> {
    throw new Error('unused');
  }
  async getEvent(): Promise<any> {
    return undefined;
  }
  async updateEventStatus(): Promise<any> {
    return undefined;
  }
  async upsertRsvp(): Promise<any> {
    throw new Error('unused');
  }
  async deleteOwnerData(): Promise<number> {
    return 0;
  }
  async claimIdempotencyKey(): Promise<boolean> {
    return true;
  }
  async cleanup(): Promise<number> {
    return 0;
  }
  async healthCheck(): Promise<boolean> {
    return true;
  }
  async closeConnection(): Promise<void> {}
}
