import type { EngagementCard } from './discord-ui.js';
import { buildEngagementButton, buildEngagementCard } from './discord-ui.js';
import type { Suggestion, SuggestionStatus } from './domain.js';
import {
  EngagementRecordConflictError,
  type EngagementRepository,
} from './storage.js';
import type { RateLimiter } from '../security/rate-limiter.js';

const moderationTtlMs = 14 * 24 * 60 * 60 * 1_000;
const draftTtlMs = 15 * 60 * 1_000;

export type SuggestionErrorCode =
  | 'invalid-input'
  | 'missing-channel'
  | 'opted-out'
  | 'duplicate'
  | 'rate-limit'
  | 'forbidden'
  | 'not-found'
  | 'expired'
  | 'duplicate-action'
  | 'draft-limit'
  | 'persistence-failed';

export class SuggestionServiceError extends Error {
  constructor(readonly code: SuggestionErrorCode) {
    super(code);
  }
}

export type SuggestionModerationAction =
  'acknowledge' | 'defer' | 'resolve' | 'archive';

export interface SuggestionGateway {
  post(
    channelId: string,
    card: EngagementCard,
  ): Promise<Readonly<{ id: string }>>;
  delete(channelId: string, messageId: string): Promise<void>;
  edit(
    channelId: string,
    messageId: string,
    card: EngagementCard,
  ): Promise<void>;
}

export interface SuggestionAuditEvent {
  readonly operation: 'suggestion-moderation';
  readonly action: SuggestionModerationAction;
  readonly guildId: string;
  readonly suggestionId: string;
  readonly actorUserId: string;
}

export class SuggestionService {
  private readonly drafts = new Map<
    string,
    Readonly<{ value: Suggestion; expiresAt: Date }>
  >();
  private readonly confirming = new Set<string>();

  constructor(
    private readonly dependencies: Readonly<{
      repository: EngagementRepository;
      gateway: SuggestionGateway;
      rateLimiter: RateLimiter;
      createId: () => string;
      adminRoleIds: ReadonlySet<string>;
      now?: () => Date;
      audit?: (event: SuggestionAuditEvent) => void;
      onPersistenceFailure?: (
        event: Readonly<{ guildId: string; suggestionId: string }>,
      ) => void;
      onCardRefreshFailure?: (
        event: Readonly<{
          guildId: string;
          suggestionId: string;
          messageId: string;
        }>,
      ) => void;
      maxDraftsPerOwner?: number;
    }>,
  ) {}

  async preview(
    input: Readonly<{
      guildId: string;
      ownerUserId: string;
      channelId: string;
      title: string;
      description: string;
    }>,
  ): Promise<Suggestion> {
    this.cleanupDrafts();
    const guildId = input.guildId.trim();
    const ownerUserId = input.ownerUserId.trim();
    const channelId = input.channelId.trim();
    const title = bounded(input.title, 120);
    const description = bounded(input.description, 1_000);
    if (channelId === '') throw new SuggestionServiceError('missing-channel');
    if (
      guildId === '' ||
      ownerUserId === '' ||
      title === undefined ||
      description === undefined
    )
      throw new SuggestionServiceError('invalid-input');
    if (
      (await this.dependencies.repository.getOptOut(guildId, ownerUserId)) !==
      undefined
    )
      throw new SuggestionServiceError('opted-out');
    const now = this.now();
    if (
      [...this.drafts.values()].filter(
        (draft) =>
          draft.value.guildId === guildId &&
          draft.value.ownerUserId === ownerUserId,
      ).length >= (this.dependencies.maxDraftsPerOwner ?? 3)
    )
      throw new SuggestionServiceError('draft-limit');
    const value: Suggestion = {
      id: this.dependencies.createId(),
      guildId,
      channelId,
      ownerUserId,
      title,
      description,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    };
    this.drafts.set(value.id, {
      value,
      expiresAt: new Date(now.getTime() + draftTtlMs),
    });
    return value;
  }

  async confirm(
    input: Readonly<{ guildId: string; ownerUserId: string; draftId: string }>,
  ): Promise<Suggestion> {
    this.cleanupDrafts();
    const draftId = input.draftId.trim();
    const draft = this.drafts.get(draftId);
    const value = draft?.value;
    if (
      value === undefined ||
      value.guildId !== input.guildId.trim() ||
      value.ownerUserId !== input.ownerUserId.trim()
    )
      throw new SuggestionServiceError('invalid-input');
    if (this.confirming.has(draftId))
      throw new SuggestionServiceError('invalid-input');
    this.confirming.add(draftId);
    try {
      if (
        (await this.dependencies.repository.getOptOut(
          value.guildId,
          value.ownerUserId,
        )) !== undefined
      )
        throw new SuggestionServiceError('opted-out');
      if (
        (await this.dependencies.repository.findActiveSuggestionByContent(
          value.guildId,
          value.title,
          value.description,
        )) !== undefined
      )
        throw new SuggestionServiceError('duplicate');
      if (
        !this.dependencies.rateLimiter.consume(
          `suggestion:${value.guildId}:${value.ownerUserId}`,
        ).allowed
      )
        throw new SuggestionServiceError('rate-limit');
      try {
        await this.dependencies.repository.createSuggestion(value);
      } catch (error) {
        if (error instanceof EngagementRecordConflictError)
          throw new SuggestionServiceError('duplicate');
        throw error;
      }
      this.drafts.delete(value.id);
      let messageId: string | undefined;
      try {
        const message = await this.dependencies.gateway.post(
          value.channelId,
          buildSuggestionCard(value),
        );
        messageId = message.id;
        return (
          (await this.dependencies.repository.updateSuggestionMessageId(
            value.guildId,
            value.id,
            message.id,
          )) ?? value
        );
      } catch (error) {
        if (messageId !== undefined) {
          try {
            await this.dependencies.repository.markSuggestionCleanupPending(
              value.guildId,
              value.id,
              messageId,
              this.now(),
            );
          } catch {
            this.dependencies.onPersistenceFailure?.({
              guildId: value.guildId,
              suggestionId: value.id,
            });
            throw new SuggestionServiceError('persistence-failed');
          }
        } else {
          await this.dependencies.repository.deleteSuggestionRecord(
            value.guildId,
            value.id,
          );
        }
        throw error;
      }
    } finally {
      this.confirming.delete(draftId);
    }
  }

  cancel(
    input: Readonly<{ guildId: string; ownerUserId: string; draftId: string }>,
  ): boolean {
    this.cleanupDrafts();
    const value = this.drafts.get(input.draftId.trim())?.value;
    if (
      value === undefined ||
      value.guildId !== input.guildId.trim() ||
      value.ownerUserId !== input.ownerUserId.trim()
    )
      return false;
    this.drafts.delete(value.id);
    return true;
  }

  async submit(
    input: Readonly<{
      guildId: string;
      ownerUserId: string;
      channelId: string;
      title: string;
      description: string;
    }>,
  ): Promise<Suggestion> {
    const draft = await this.preview(input);
    return this.confirm({
      guildId: draft.guildId,
      ownerUserId: draft.ownerUserId,
      draftId: draft.id,
    });
  }

  async delete(
    input: Readonly<{
      guildId: string;
      ownerUserId: string;
      suggestionId: string;
    }>,
  ): Promise<boolean> {
    const value =
      await this.dependencies.repository.claimOpenSuggestionForDeletion(
        input.guildId.trim(),
        input.ownerUserId.trim(),
        input.suggestionId.trim(),
        this.now(),
      );
    if (value === undefined) return false;
    if (value.messageId?.trim())
      await this.dependencies.gateway.delete(value.channelId, value.messageId);
    return this.dependencies.repository.deleteSuggestionRecord(
      value.guildId,
      value.id,
    );
  }

  async moderate(
    input: Readonly<{
      guildId: string;
      channelId: string;
      moderatorUserId: string;
      moderatorRoleIds: ReadonlySet<string>;
      suggestionId: string;
      action: SuggestionModerationAction;
      interactionId: string;
      now?: Date;
    }>,
  ): Promise<Suggestion> {
    const guildId = input.guildId.trim();
    const channelId = input.channelId.trim();
    if (
      guildId === '' ||
      channelId === '' ||
      !hasAdminRole(input.moderatorRoleIds, this.dependencies.adminRoleIds)
    )
      throw new SuggestionServiceError('forbidden');
    const value = await this.dependencies.repository.getSuggestion(
      guildId,
      input.suggestionId.trim(),
    );
    if (
      value === undefined ||
      value.channelId !== channelId ||
      value.status === 'archived' ||
      value.status === 'deletion_pending' ||
      value.status === 'cleanup_pending'
    )
      throw new SuggestionServiceError('not-found');
    const now = input.now ?? this.now();
    if (value.createdAt.getTime() + moderationTtlMs <= now.getTime())
      throw new SuggestionServiceError('expired');
    if (
      !(await this.dependencies.repository.claimIdempotencyKey(
        guildId,
        'interaction',
        input.interactionId.trim(),
        now,
      ))
    )
      throw new SuggestionServiceError('duplicate-action');
    const status = statusFor(input.action);
    const updated =
      await this.dependencies.repository.transitionSuggestionStatus(
        guildId,
        value.id,
        value.status,
        status,
        now,
      );
    if (updated === undefined) throw new SuggestionServiceError('not-found');
    this.dependencies.audit?.({
      operation: 'suggestion-moderation',
      action: input.action,
      guildId,
      suggestionId: value.id,
      actorUserId: input.moderatorUserId.trim(),
    });
    if (updated.messageId?.trim()) {
      try {
        const card = buildSuggestionCard(updated, false);
        try {
          await this.dependencies.gateway.edit(
            updated.channelId,
            updated.messageId,
            card,
          );
        } catch {
          // One bounded retry covers transient Discord transport failures.
          await this.dependencies.gateway.edit(
            updated.channelId,
            updated.messageId,
            card,
          );
        }
      } catch {
        this.dependencies.onCardRefreshFailure?.({
          guildId,
          suggestionId: updated.id,
          messageId: updated.messageId,
        });
      }
    }
    return updated;
  }

  private now(): Date {
    return (this.dependencies.now ?? (() => new Date()))();
  }

  cleanupDrafts(now = this.now()): number {
    let removed = 0;
    for (const [id, draft] of this.drafts) {
      if (draft.expiresAt.getTime() <= now.getTime()) {
        this.drafts.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  async cleanupPostedCards(
    cutoffOrLimit: Date | number = 100,
    requestedLimit?: number,
  ): Promise<number> {
    const cutoff = cutoffOrLimit instanceof Date ? cutoffOrLimit : undefined;
    const limit =
      cutoffOrLimit instanceof Date ? (requestedLimit ?? 100) : cutoffOrLimit;
    if (cutoff !== undefined)
      await this.dependencies.repository.claimExpiredSuggestions?.(
        cutoff,
        limit,
        this.now(),
      );
    let removed = 0;
    for (const value of await this.dependencies.repository.listCleanupPendingSuggestions(
      limit,
    )) {
      try {
        if (value.messageId?.trim())
          await this.dependencies.gateway.delete(
            value.channelId,
            value.messageId,
          );
        if (
          await this.dependencies.repository.deleteSuggestionRecord(
            value.guildId,
            value.id,
          )
        )
          removed += 1;
      } catch {
        // Preserve durable cleanup state for the next bounded retry.
      }
    }
    return removed;
  }
}

export const buildSuggestionCard = (
  value: Pick<Suggestion, 'id' | 'title' | 'description' | 'status'>,
  controlsEnabled = true,
): EngagementCard =>
  buildEngagementCard({
    title: `Suggestion: ${value.title}`,
    description: value.description,
    fields: [{ name: 'Status', value: value.status }],
    components: [
      {
        type: 'actionRow',
        components: [
          buildEngagementButton({
            customId: `suggestion:v1:${value.id}:acknowledge`,
            label: 'Acknowledge',
            style: 'primary',
            disabled: !controlsEnabled,
          }),
          buildEngagementButton({
            customId: `suggestion:v1:${value.id}:defer`,
            label: 'Defer',
            style: 'secondary',
            disabled: !controlsEnabled,
          }),
          buildEngagementButton({
            customId: `suggestion:v1:${value.id}:resolve`,
            label: 'Resolve',
            style: 'success',
            disabled: !controlsEnabled,
          }),
          buildEngagementButton({
            customId: `suggestion:v1:${value.id}:archive`,
            label: 'Archive',
            style: 'danger',
            disabled: !controlsEnabled,
          }),
        ],
      },
    ],
  });

const bounded = (value: string, maximum: number): string | undefined => {
  const normalized = value.trim();
  return normalized === '' || normalized.length > maximum
    ? undefined
    : normalized;
};
const hasAdminRole = (
  memberRoleIds: ReadonlySet<string>,
  configuredRoleIds: ReadonlySet<string>,
): boolean =>
  [...configuredRoleIds].some((roleId) => memberRoleIds.has(roleId));
const statusFor = (action: SuggestionModerationAction): SuggestionStatus =>
  action === 'acknowledge'
    ? 'acknowledged'
    : action === 'defer'
      ? 'deferred'
      : action === 'resolve'
        ? 'resolved'
        : 'archived';
