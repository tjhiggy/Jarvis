import type { EngagementCard } from './discord-ui.js';
import { buildEngagementButton, buildEngagementCard } from './discord-ui.js';
import type { Suggestion, SuggestionStatus } from './domain.js';
import {
  EngagementRecordConflictError,
  type EngagementRepository,
} from './storage.js';
import type { RateLimiter } from '../security/rate-limiter.js';

const moderationTtlMs = 14 * 24 * 60 * 60 * 1_000;

export type SuggestionErrorCode =
  | 'invalid-input'
  | 'missing-channel'
  | 'opted-out'
  | 'duplicate'
  | 'rate-limit'
  | 'forbidden'
  | 'not-found'
  | 'expired'
  | 'duplicate-action';

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
}

export interface SuggestionAuditEvent {
  readonly operation: 'suggestion-moderation';
  readonly action: SuggestionModerationAction;
  readonly guildId: string;
  readonly suggestionId: string;
  readonly actorUserId: string;
}

export class SuggestionService {
  private readonly drafts = new Map<string, Suggestion>();

  constructor(
    private readonly dependencies: Readonly<{
      repository: EngagementRepository;
      gateway: SuggestionGateway;
      rateLimiter: RateLimiter;
      createId: () => string;
      adminRoleIds: ReadonlySet<string>;
      now?: () => Date;
      audit?: (event: SuggestionAuditEvent) => void;
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
    this.drafts.set(value.id, value);
    return value;
  }

  async confirm(
    input: Readonly<{ guildId: string; ownerUserId: string; draftId: string }>,
  ): Promise<Suggestion> {
    const value = this.drafts.get(input.draftId.trim());
    if (
      value === undefined ||
      value.guildId !== input.guildId.trim() ||
      value.ownerUserId !== input.ownerUserId.trim()
    )
      throw new SuggestionServiceError('invalid-input');
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
    try {
      await this.dependencies.gateway.post(
        value.channelId,
        buildSuggestionCard(value),
      );
      return value;
    } catch (error) {
      await this.dependencies.repository.updateSuggestionStatus(
        value.guildId,
        value.id,
        'archived',
        this.now(),
      );
      throw error;
    }
  }

  cancel(
    input: Readonly<{ guildId: string; ownerUserId: string; draftId: string }>,
  ): boolean {
    const value = this.drafts.get(input.draftId.trim());
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
    const value = await this.dependencies.repository.getSuggestion(
      input.guildId.trim(),
      input.suggestionId.trim(),
    );
    if (
      value === undefined ||
      value.ownerUserId !== input.ownerUserId.trim() ||
      value.status !== 'open'
    )
      return false;
    return (
      (await this.dependencies.repository.updateSuggestionStatus(
        value.guildId,
        value.id,
        'archived',
        this.now(),
      )) !== undefined
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
      value.status === 'archived'
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
    const updated = await this.dependencies.repository.updateSuggestionStatus(
      guildId,
      value.id,
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
    return updated;
  }

  private now(): Date {
    return (this.dependencies.now ?? (() => new Date()))();
  }
}

export const buildSuggestionCard = (
  value: Pick<Suggestion, 'id' | 'title' | 'description' | 'status'>,
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
          }),
          buildEngagementButton({
            customId: `suggestion:v1:${value.id}:defer`,
            label: 'Defer',
            style: 'secondary',
          }),
          buildEngagementButton({
            customId: `suggestion:v1:${value.id}:resolve`,
            label: 'Resolve',
            style: 'success',
          }),
          buildEngagementButton({
            customId: `suggestion:v1:${value.id}:archive`,
            label: 'Archive',
            style: 'danger',
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
