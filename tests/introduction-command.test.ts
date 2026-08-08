import { describe, expect, it } from 'vitest';

import { IntroductionService } from '../src/engagement/introductions.js';
import type { EngagementRepository } from '../src/engagement/storage.js';
import { RateLimiter } from '../src/security/rate-limiter.js';

describe('IntroductionService', () => {
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
    const service = createService(repository, new Gateway(), 1);
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
    repository.introductions.get('guild-1:intro-1').status = 'deleted';
    await expect(service.submit(input)).rejects.toMatchObject({
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
  repository: MemoryRepository,
  gateway: Gateway,
  capacity = 5,
) {
  return new IntroductionService({
    repository,
    gateway,
    rateLimiter: new RateLimiter(capacity, 60_000),
    createId: () => 'intro-1',
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
  async delete(channelId: string, messageId: string) {
    this.deletes.push({ channelId, messageId });
  }
}

class MemoryRepository implements EngagementRepository {
  introductions = new Map<string, any>();
  optedOut = new Map<string, any>();
  async createIntroduction(value: any) {
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
