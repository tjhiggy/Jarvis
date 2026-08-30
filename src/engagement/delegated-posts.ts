import { buildEngagementCard, type EngagementCard } from './discord-ui.js';
import { neutralizeDiscordMentions } from '../utils/mentions.js';

export class DelegatedPostError extends Error {
  constructor(
    readonly code:
      | 'forbidden'
      | 'invalid-input'
      | 'missing-channel'
      | 'duplicate'
      | 'not-found'
      | 'expired',
  ) {
    super(code);
  }
}
export interface DelegatedPostGateway {
  post(
    channelId: string,
    card: EngagementCard,
  ): Promise<Readonly<{ id: string }>>;
}
export interface DelegatedPostDraft {
  readonly id: string;
  readonly guildId: string;
  readonly ownerUserId: string;
  readonly ownerName: string;
  readonly channelId: string;
  readonly content: string;
  readonly createdAt: Date;
}

const ttlMs = 15 * 60 * 1_000;
const bound = (value: string, max: number): string => {
  const clean = neutralizeDiscordMentions(value).trim();
  return clean !== '' && clean.length <= max ? clean : '';
};

export class DelegatedPostService {
  private readonly drafts = new Map<
    string,
    { value: DelegatedPostDraft; expiresAt: number }
  >();
  constructor(
    private readonly dependencies: Readonly<{
      gateway: DelegatedPostGateway;
      createId: () => string;
      adminRoleIds: ReadonlySet<string>;
      now?: () => Date;
    }>,
  ) {}
  preview(
    input: Readonly<{
      guildId: string;
      ownerUserId: string;
      ownerName: string;
      ownerRoleIds: ReadonlySet<string>;
      channelId: string;
      content: string;
    }>,
  ): DelegatedPostDraft {
    if (
      ![...this.dependencies.adminRoleIds].some((role) =>
        input.ownerRoleIds.has(role),
      )
    )
      throw new DelegatedPostError('forbidden');
    const guildId = input.guildId.trim(),
      ownerUserId = input.ownerUserId.trim(),
      channelId = input.channelId.trim(),
      content = bound(input.content, 1_500);
    if (!guildId || !ownerUserId || !channelId)
      throw new DelegatedPostError('missing-channel');
    if (!content) throw new DelegatedPostError('invalid-input');
    this.cleanup();
    if (
      [...this.drafts.values()].some(
        (d) =>
          d.value.guildId === guildId &&
          d.value.ownerUserId === ownerUserId &&
          d.value.content === content,
      )
    )
      throw new DelegatedPostError('duplicate');
    const now = this.now();
    const draft = {
      id: this.dependencies.createId(),
      guildId,
      ownerUserId,
      ownerName: bound(input.ownerName, 80) || 'MuthaShip administrator',
      channelId,
      content,
      createdAt: now,
    };
    this.drafts.set(draft.id, {
      value: draft,
      expiresAt: now.getTime() + ttlMs,
    });
    return draft;
  }
  async confirm(
    input: Readonly<{ guildId: string; ownerUserId: string; draftId: string }>,
  ): Promise<Readonly<{ id: string }>> {
    this.cleanup();
    const draft = this.drafts.get(input.draftId)?.value;
    if (
      !draft ||
      draft.guildId !== input.guildId ||
      draft.ownerUserId !== input.ownerUserId
    )
      throw new DelegatedPostError('not-found');
    this.drafts.delete(input.draftId);
    const card = buildEngagementCard({
      title: 'MuthaShip transmission',
      description: draft.content,
      fields: [{ name: 'Sent by', value: draft.ownerName }],
    });
    try {
      return await this.dependencies.gateway.post(draft.channelId, card);
    } catch (error) {
      this.drafts.set(draft.id, {
        value: draft,
        expiresAt: this.now().getTime() + ttlMs,
      });
      throw error;
    }
  }
  cancel(
    input: Readonly<{ guildId: string; ownerUserId: string; draftId: string }>,
  ): boolean {
    const draft = this.drafts.get(input.draftId)?.value;
    if (
      !draft ||
      draft.guildId !== input.guildId ||
      draft.ownerUserId !== input.ownerUserId
    )
      return false;
    this.drafts.delete(input.draftId);
    return true;
  }
  cleanup(): void {
    const now = this.now().getTime();
    for (const [id, draft] of this.drafts)
      if (draft.expiresAt <= now) this.drafts.delete(id);
  }
  private now(): Date {
    return this.dependencies.now?.() ?? new Date();
  }
}
