import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/security/rate-limiter.js';
import { SuggestionService } from '../src/engagement/suggestions.js';
import type { EngagementRepository } from '../src/engagement/storage.js';

describe('SuggestionService', () => {
  it('keeps suggestions private until confirmation and posts a safe normalized card', async () => {
    const repository = new SuggestionsRepository();
    const gateway = new SuggestionGateway();
    const service = createService(repository, gateway);
    const draft = await service.preview(
      input({ title: '  Better @everyone nights  ' }),
    );

    expect(gateway.cards).toEqual([]);
    await service.confirm({
      guildId: 'guild-1',
      ownerUserId: 'user-1',
      draftId: draft.id,
    });

    expect(gateway.cards[0]?.channelId).toBe('suggestions');
    expect(JSON.stringify(gateway.cards[0]?.card)).toContain('@\u200beveryone');
    expect(gateway.cards[0]?.card.allowedMentions).toEqual({
      parse: [],
      repliedUser: false,
    });
  });

  it('deduplicates, limits submissions, and lets the author delete an untriaged record and bot-owned card', async () => {
    const repository = new SuggestionsRepository();
    const gateway = new SuggestionGateway();
    const service = createService(repository, gateway, 1);
    const created = await service.submit(input());

    await expect(service.submit(input())).rejects.toMatchObject({
      code: 'duplicate',
    });
    await expect(
      service.delete({
        guildId: 'guild-1',
        ownerUserId: 'user-2',
        suggestionId: created.id,
      }),
    ).resolves.toBe(false);
    await expect(
      service.delete({
        guildId: 'guild-1',
        ownerUserId: 'user-1',
        suggestionId: created.id,
      }),
    ).resolves.toBe(true);
    expect(gateway.deletes).toEqual([
      { channelId: 'suggestions', messageId: 'message-1' },
    ]);
    await expect(
      repository.getSuggestion('guild-1', created.id),
    ).resolves.toBeUndefined();
    await expect(
      service.submit(input({ title: 'A fresh idea' })),
    ).rejects.toMatchObject({ code: 'rate-limit' });
  });

  it('expires and bounds private drafts per owner, with explicit cleanup', async () => {
    const repository = new SuggestionsRepository();
    const gateway = new SuggestionGateway();
    let now = new Date('2026-08-08T12:00:00.000Z');
    const service = createService(repository, gateway, 5, [], () => now, 1);
    await service.preview(input());
    await expect(
      service.preview(input({ title: 'Another idea' })),
    ).rejects.toMatchObject({ code: 'draft-limit' });
    now = new Date('2026-08-08T12:16:00.000Z');
    expect(service.cleanupDrafts()).toBe(1);
    await expect(
      service.preview(input({ title: 'Another idea' })),
    ).resolves.toMatchObject({ title: 'Another idea' });
  });

  it('does not remove a suggestion that loses the delete claim to triage', async () => {
    const repository = new SuggestionsRepository();
    const service = createService(repository, new SuggestionGateway());
    const created = await service.submit(input());
    repository.suggestions.get(`guild-1:${created.id}`).status = 'acknowledged';
    await expect(
      service.delete({
        guildId: 'guild-1',
        ownerUserId: 'user-1',
        suggestionId: created.id,
      }),
    ).resolves.toBe(false);
    await expect(
      repository.getSuggestion('guild-1', created.id),
    ).resolves.toMatchObject({ status: 'acknowledged' });
  });

  it('compensates for message-id persistence failure by deleting the posted card', async () => {
    const repository = new SuggestionsRepository();
    repository.failMessageUpdate = true;
    const gateway = new SuggestionGateway();
    const service = createService(repository, gateway);
    await expect(service.submit(input())).rejects.toThrow();
    expect(gateway.deletes).toEqual([
      { channelId: 'suggestions', messageId: 'message-1' },
    ]);
    await expect(
      repository.getSuggestion('guild-1', 'suggestion-1'),
    ).resolves.toMatchObject({ id: 'suggestion-1' });
  });

  it('restricts status controls to configured roles, expires controls, and records safe audits', async () => {
    const repository = new SuggestionsRepository();
    const events: unknown[] = [];
    const service = createService(
      repository,
      new SuggestionGateway(),
      5,
      events,
    );
    const created = await service.submit(input());

    await expect(
      service.moderate({
        guildId: 'guild-1',
        channelId: 'suggestions',
        moderatorUserId: 'user-2',
        moderatorRoleIds: new Set(),
        suggestionId: created.id,
        action: 'acknowledge',
        interactionId: 'click-1',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    await expect(
      service.moderate({
        guildId: 'guild-1',
        channelId: 'suggestions',
        moderatorUserId: 'admin-1',
        moderatorRoleIds: new Set(['role-admin']),
        suggestionId: created.id,
        action: 'acknowledge',
        interactionId: 'click-2',
      }),
    ).resolves.toMatchObject({ status: 'acknowledged' });
    await expect(
      service.moderate({
        guildId: 'guild-1',
        channelId: 'suggestions',
        moderatorUserId: 'admin-1',
        moderatorRoleIds: new Set(['role-admin']),
        suggestionId: created.id,
        action: 'resolve',
        interactionId: 'click-2',
      }),
    ).rejects.toMatchObject({ code: 'duplicate-action' });
    expect(events).toEqual([
      expect.objectContaining({
        action: 'acknowledge',
        suggestionId: created.id,
      }),
    ]);

    await expect(
      service.moderate({
        guildId: 'guild-1',
        channelId: 'suggestions',
        moderatorUserId: 'admin-1',
        moderatorRoleIds: new Set(['role-admin']),
        suggestionId: created.id,
        action: 'resolve',
        interactionId: 'click-3',
        now: new Date('2026-09-01T00:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'expired' });
  });
});

function input(
  overrides: Partial<{ title: string; description: string }> = {},
) {
  return {
    guildId: 'guild-1',
    ownerUserId: 'user-1',
    channelId: 'suggestions',
    title: overrides.title ?? 'Movie night',
    description: overrides.description ?? 'Add a weekly crew movie night.',
  };
}

function createService(
  repository: EngagementRepository,
  gateway: SuggestionGateway,
  capacity = 5,
  events: unknown[] = [],
  now: () => Date = () => new Date('2026-08-08T12:00:00.000Z'),
  maxDraftsPerOwner = 3,
) {
  let id = 1;
  return new SuggestionService({
    repository,
    gateway,
    rateLimiter: new RateLimiter(capacity, 60_000),
    createId: () => `suggestion-${id++}`,
    adminRoleIds: new Set(['role-admin']),
    now,
    maxDraftsPerOwner,
    audit: (event) => events.push(event),
  });
}

class SuggestionGateway {
  cards: Array<any> = [];
  deletes: Array<{ channelId: string; messageId: string }> = [];
  async post(channelId: string, card: any) {
    this.cards.push({ channelId, card });
    return { id: 'message-1' };
  }
  async delete(channelId: string, messageId: string) {
    this.deletes.push({ channelId, messageId });
  }
}
class SuggestionsRepository implements EngagementRepository {
  suggestions = new Map<string, any>();
  failMessageUpdate = false;
  optedOut = new Map<string, any>();
  claimed = new Set<string>();
  async createSuggestion(value: any) {
    this.suggestions.set(`${value.guildId}:${value.id}`, { ...value });
    return value;
  }
  async getSuggestion(guildId: string, id: string) {
    return this.suggestions.get(`${guildId}:${id}`);
  }
  async findActiveSuggestionByContent(
    guildId: string,
    title: string,
    description: string,
  ) {
    return [...this.suggestions.values()].find(
      (value) =>
        value.guildId === guildId &&
        value.title === title &&
        value.description === description &&
        value.status !== 'archived',
    );
  }
  async updateSuggestionStatus(
    guildId: string,
    id: string,
    status: any,
    updatedAt: Date,
  ) {
    const value = await this.getSuggestion(guildId, id);
    if (value !== undefined) Object.assign(value, { status, updatedAt });
    return value;
  }
  async updateSuggestionMessageId(
    guildId: string,
    id: string,
    messageId: string,
  ) {
    if (this.failMessageUpdate) throw new Error('database unavailable');
    const value = await this.getSuggestion(guildId, id);
    if (value !== undefined) value.messageId = messageId;
    return value;
  }
  async deleteSuggestionRecord(guildId: string, id: string) {
    return this.suggestions.delete(`${guildId}:${id}`);
  }
  async claimOpenSuggestionForDeletion(
    guildId: string,
    ownerUserId: string,
    id: string,
    updatedAt: Date,
  ) {
    const value = await this.getSuggestion(guildId, id);
    if (value?.ownerUserId !== ownerUserId || value.status !== 'open')
      return undefined;
    value.status = 'deletion_pending';
    value.updatedAt = updatedAt;
    return value;
  }
  async deletePendingSuggestionRecord(guildId: string, id: string) {
    const value = await this.getSuggestion(guildId, id);
    return (
      value?.status === 'deletion_pending' &&
      this.suggestions.delete(`${guildId}:${id}`)
    );
  }
  async restorePendingSuggestion(guildId: string, id: string, updatedAt: Date) {
    const value = await this.getSuggestion(guildId, id);
    if (value?.status === 'deletion_pending')
      Object.assign(value, { status: 'open', updatedAt });
    return value;
  }
  async getOptOut(guildId: string, userId: string) {
    return this.optedOut.get(`${guildId}:${userId}`);
  }
  async setOptOut(value: any) {
    this.optedOut.set(`${value.guildId}:${value.userId}`, value);
    return value;
  }
  async claimIdempotencyKey(_guildId: string, _scope: any, key: string) {
    if (this.claimed.has(key)) return false;
    this.claimed.add(key);
    return true;
  }
  async createIntroduction(): Promise<any> {
    throw new Error('unused');
  }
  async getIntroduction(): Promise<any> {
    return undefined;
  }
  async findActiveIntroductionByOwner(): Promise<any> {
    return undefined;
  }
  async updateIntroductionMessageId(): Promise<any> {
    return undefined;
  }
  async updateIntroductionStatus(): Promise<any> {
    return undefined;
  }
  async listExpiredIntroductions(): Promise<any[]> {
    return [];
  }
  async deleteIntroductionRecord(): Promise<boolean> {
    return false;
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
  async cleanup(): Promise<number> {
    return 0;
  }
  async healthCheck(): Promise<boolean> {
    return true;
  }
  async closeConnection(): Promise<void> {}
}
