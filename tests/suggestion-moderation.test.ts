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

  it('keeps failed owner deletion cleanup-pending and retries the card before deleting content', async () => {
    const repository = new SuggestionsRepository();
    const gateway = new SuggestionGateway();
    const service = createService(repository, gateway);
    const created = await service.submit(input());
    gateway.delete = async () => {
      throw new Error('Discord unavailable');
    };

    await expect(
      service.delete({
        guildId: 'guild-1',
        ownerUserId: 'user-1',
        suggestionId: created.id,
      }),
    ).rejects.toThrow();
    await expect(
      repository.getSuggestion('guild-1', created.id),
    ).resolves.toMatchObject({ status: 'cleanup_pending' });

    gateway.delete = async (channelId, messageId) => {
      gateway.deletes.push({ channelId, messageId });
    };
    await expect(
      service.cleanupPostedCards(new Date('2030-01-01T00:00:00.000Z'), 10),
    ).resolves.toBe(1);
    await expect(
      repository.getSuggestion('guild-1', created.id),
    ).resolves.toBeUndefined();
  });

  it('expires retained suggestions by deleting their cards before their content rows', async () => {
    const repository = new SuggestionsRepository();
    const gateway = new SuggestionGateway();
    const service = createService(repository, gateway);
    const created = await service.submit(input());
    repository.suggestions.get(`guild-1:${created.id}`).updatedAt = new Date(
      '2026-01-01T00:00:00.000Z',
    );

    await expect(
      service.cleanupPostedCards(new Date('2026-02-01T00:00:00.000Z'), 10),
    ).resolves.toBe(1);
    expect(gateway.deletes).toContainEqual({
      channelId: 'suggestions',
      messageId: 'message-1',
    });
    await expect(
      repository.getSuggestion('guild-1', created.id),
    ).resolves.toBeUndefined();
  });

  it('does not let moderation overwrite a deletion-pending suggestion', async () => {
    const repository = new SuggestionsRepository();
    const service = createService(repository, new SuggestionGateway());
    const created = await service.submit(input());
    repository.suggestions.get(`guild-1:${created.id}`).status =
      'deletion_pending';
    await expect(
      service.moderate({
        guildId: 'guild-1',
        channelId: 'suggestions',
        moderatorUserId: 'admin-1',
        moderatorRoleIds: new Set(['role-admin']),
        suggestionId: created.id,
        action: 'resolve',
        interactionId: 'race-click',
      }),
    ).rejects.toMatchObject({ code: 'not-found' });
    await expect(
      repository.getSuggestion('guild-1', created.id),
    ).resolves.toMatchObject({ status: 'deletion_pending' });
  });

  it('rejects a real moderation/delete interleaving after the moderation read', async () => {
    const repository = new SuggestionsRepository();
    const service = createService(repository, new SuggestionGateway());
    const created = await service.submit(input());
    repository.cloneOnGet = true;
    repository.afterSuggestionRead = () => {
      repository.suggestions.get(`guild-1:${created.id}`).status =
        'deletion_pending';
    };
    await expect(
      service.moderate({
        guildId: 'guild-1',
        channelId: 'suggestions',
        moderatorUserId: 'admin-1',
        moderatorRoleIds: new Set(['role-admin']),
        suggestionId: created.id,
        action: 'resolve',
        interactionId: 'interleave-click',
      }),
    ).rejects.toMatchObject({ code: 'not-found' });
    expect(repository.suggestions.get(`guild-1:${created.id}`)).toMatchObject({
      status: 'deletion_pending',
    });
  });

  it('persists a cleanup-pending record when message-id persistence fails after posting', async () => {
    const repository = new SuggestionsRepository();
    repository.failMessageUpdate = true;
    const gateway = new SuggestionGateway();
    const service = createService(repository, gateway);
    await expect(service.submit(input())).rejects.toThrow();
    expect(gateway.deletes).toEqual([]);
    await expect(
      repository.getSuggestion('guild-1', 'suggestion-1'),
    ).resolves.toMatchObject({
      id: 'suggestion-1',
      messageId: 'message-1',
      status: 'cleanup_pending',
    });
  });

  it('surfaces an operator-visible persistence failure when durable cleanup cannot be recorded', async () => {
    const repository = new SuggestionsRepository();
    repository.failMessageUpdate = true;
    repository.failCleanupMark = true;
    await expect(
      createService(repository, new SuggestionGateway()).submit(input()),
    ).rejects.toMatchObject({ code: 'persistence-failed' });
    await expect(
      repository.getSuggestion('guild-1', 'suggestion-1'),
    ).resolves.toMatchObject({ id: 'suggestion-1' });
  });

  it('restricts status controls to configured roles, expires controls, and records safe audits', async () => {
    const repository = new SuggestionsRepository();
    const events: unknown[] = [];
    const gateway = new SuggestionGateway();
    const service = createService(repository, gateway, 5, events);
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
    expect(gateway.edits).toEqual([
      expect.objectContaining({
        channelId: 'suggestions',
        messageId: 'message-1',
      }),
    ]);
    expect(gateway.edits[0]?.card.embeds[0]?.fields?.[0]?.value).toBe(
      'acknowledged',
    );
    expect(
      gateway.edits[0]?.card.components?.[0]?.components.every(
        (component: any) => component.disabled === true,
      ),
    ).toBe(true);

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

  it('keeps the database truth when refreshing the Discord card fails', async () => {
    const repository = new SuggestionsRepository();
    const gateway = new SuggestionGateway();
    gateway.failEdit = true;
    const refreshFailures: unknown[] = [];
    const service = new SuggestionService({
      repository,
      gateway,
      rateLimiter: new RateLimiter(5, 60_000),
      createId: () => 'suggestion-1',
      adminRoleIds: new Set(['role-admin']),
      onCardRefreshFailure: (event) => refreshFailures.push(event),
    });
    const created = await service.submit(input());
    await expect(
      service.moderate({
        guildId: 'guild-1',
        channelId: 'suggestions',
        moderatorUserId: 'admin-1',
        moderatorRoleIds: new Set(['role-admin']),
        suggestionId: created.id,
        action: 'resolve',
        interactionId: 'refresh-failure',
      }),
    ).resolves.toMatchObject({ status: 'resolved' });
    await expect(
      repository.getSuggestion('guild-1', created.id),
    ).resolves.toMatchObject({ status: 'resolved' });
    expect(refreshFailures).toEqual([
      { guildId: 'guild-1', suggestionId: created.id, messageId: 'message-1' },
    ]);
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
  edits: Array<{ channelId: string; messageId: string; card: any }> = [];
  failEdit = false;
  async post(channelId: string, card: any) {
    this.cards.push({ channelId, card });
    return { id: 'message-1' };
  }
  async delete(channelId: string, messageId: string) {
    this.deletes.push({ channelId, messageId });
  }
  async edit(channelId: string, messageId: string, card: any) {
    if (this.failEdit) throw new Error('Discord unavailable');
    this.edits.push({ channelId, messageId, card });
  }
}
class SuggestionsRepository implements EngagementRepository {
  suggestions = new Map<string, any>();
  failMessageUpdate = false;
  failCleanupMark = false;
  cloneOnGet = false;
  afterSuggestionRead: (() => void) | undefined;
  optedOut = new Map<string, any>();
  claimed = new Set<string>();
  async createSuggestion(value: any) {
    this.suggestions.set(`${value.guildId}:${value.id}`, { ...value });
    return value;
  }
  async getSuggestion(guildId: string, id: string) {
    const value = this.suggestions.get(`${guildId}:${id}`);
    const hook = this.afterSuggestionRead;
    this.afterSuggestionRead = undefined;
    hook?.();
    return this.cloneOnGet && value !== undefined ? { ...value } : value;
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
  async transitionSuggestionStatus(
    guildId: string,
    id: string,
    expectedStatus: any,
    status: any,
    updatedAt: Date,
  ) {
    const value = await this.getSuggestion(guildId, id);
    if (value?.status !== expectedStatus) return undefined;
    Object.assign(value, { status, updatedAt });
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
  async markSuggestionCleanupPending(
    guildId: string,
    id: string,
    messageId: string,
    updatedAt: Date,
  ) {
    if (this.failCleanupMark) throw new Error('database unavailable');
    const value = await this.getSuggestion(guildId, id);
    if (value !== undefined)
      Object.assign(value, { messageId, status: 'cleanup_pending', updatedAt });
    return value;
  }
  async listCleanupPendingSuggestions() {
    return [...this.suggestions.values()].filter(
      (value) => value.status === 'cleanup_pending',
    );
  }
  async claimExpiredSuggestions(cutoff: Date, limit: number, updatedAt: Date) {
    for (const value of [...this.suggestions.values()]
      .filter(
        (candidate) =>
          candidate.status !== 'cleanup_pending' &&
          candidate.updatedAt < cutoff,
      )
      .slice(0, limit))
      Object.assign(value, { status: 'cleanup_pending', updatedAt });
    return this.listCleanupPendingSuggestions();
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
    value.status = 'cleanup_pending';
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
