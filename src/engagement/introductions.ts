import type { Introduction } from './domain.js';
import {
  EngagementRecordConflictError,
  type EngagementRepository,
} from './storage.js';
import type { RateLimiter } from '../security/rate-limiter.js';
import { neutralizeDiscordMentions } from '../utils/mentions.js';

export type IntroductionErrorCode =
  | 'invalid-input'
  | 'missing-channel'
  | 'opted-out'
  | 'duplicate'
  | 'rate-limit';

export class IntroductionServiceError extends Error {
  constructor(readonly code: IntroductionErrorCode) {
    super(code);
  }
}

export interface IntroductionGateway {
  post(channelId: string, content: string): Promise<Readonly<{ id: string }>>;
  delete(channelId: string, messageId: string): Promise<void>;
}

export class IntroductionService {
  private readonly drafts = new Map<string, Introduction>();
  constructor(
    private readonly dependencies: Readonly<{
      repository: EngagementRepository;
      gateway: IntroductionGateway;
      rateLimiter: RateLimiter;
      createId: () => string;
      now?: () => Date;
    }>,
  ) {}

  async preview(
    input: Readonly<{
      guildId: string;
      ownerUserId: string;
      channelId: string;
      displayName: string;
      interests: string;
      introduction: string;
    }>,
  ): Promise<Introduction> {
    const guildId = input.guildId.trim();
    const ownerUserId = input.ownerUserId.trim();
    const channelId = input.channelId.trim();
    const displayName = bounded(input.displayName, 80);
    const interests = bounded(input.interests, 300);
    const introduction = bounded(input.introduction, 500);
    if (channelId === '') throw new IntroductionServiceError('missing-channel');
    if (
      guildId === '' ||
      ownerUserId === '' ||
      displayName === undefined ||
      interests === undefined ||
      introduction === undefined
    )
      throw new IntroductionServiceError('invalid-input');
    if (
      (await this.dependencies.repository.getOptOut(guildId, ownerUserId)) !==
      undefined
    )
      throw new IntroductionServiceError('opted-out');

    const now = (this.dependencies.now ?? (() => new Date()))();
    const value: Introduction = {
      id: this.dependencies.createId(),
      guildId,
      channelId,
      ownerUserId,
      displayName,
      interests,
      introduction,
      messageId: '',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };
    this.drafts.set(value.id, value);
    return value;
  }

  async confirm(
    input: Readonly<{ guildId: string; ownerUserId: string; draftId: string }>,
  ): Promise<Introduction> {
    const value = this.drafts.get(input.draftId.trim());
    if (
      value === undefined ||
      value.guildId !== input.guildId.trim() ||
      value.ownerUserId !== input.ownerUserId.trim()
    )
      throw new IntroductionServiceError('invalid-input');
    if (
      (await this.dependencies.repository.getOptOut(
        value.guildId,
        value.ownerUserId,
      )) !== undefined
    )
      throw new IntroductionServiceError('opted-out');
    if (
      !this.dependencies.rateLimiter.consume(
        `introduction:${value.guildId}:${value.ownerUserId}`,
      ).allowed
    )
      throw new IntroductionServiceError('rate-limit');
    try {
      await this.dependencies.repository.createIntroduction(value);
    } catch (error) {
      if (error instanceof EngagementRecordConflictError)
        throw new IntroductionServiceError('duplicate');
      throw error;
    }
    this.drafts.delete(value.id);
    try {
      const message = await this.dependencies.gateway.post(
        value.channelId,
        formatIntroduction(value),
      );
      return (
        (await this.dependencies.repository.updateIntroductionMessageId(
          value.guildId,
          value.id,
          message.id,
        )) ?? value
      );
    } catch (error) {
      await this.dependencies.repository.updateIntroductionStatus(
        value.guildId,
        value.ownerUserId,
        value.id,
        'deleted',
        (this.dependencies.now ?? (() => new Date()))(),
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

  async cleanup(cutoff: Date, limit: number): Promise<number> {
    const expired = await this.dependencies.repository.listExpiredIntroductions(
      cutoff,
      limit,
    );
    let removed = 0;
    for (const value of expired) {
      try {
        if (value.status === 'active') {
          await this.dependencies.repository.updateIntroductionStatus(
            value.guildId,
            value.ownerUserId,
            value.id,
            'cleanup_pending',
            (this.dependencies.now ?? (() => new Date()))(),
          );
        }
        if (value.messageId?.trim())
          await this.dependencies.gateway.delete(
            value.channelId,
            value.messageId,
          );
        if (
          await this.dependencies.repository.deleteIntroductionRecord(
            value.guildId,
            value.id,
          )
        )
          removed += 1;
      } catch {
        // Preserve the record when its card cannot be removed so a later bounded cleanup can retry.
      }
    }
    return removed;
  }

  async submit(
    input: Readonly<{
      guildId: string;
      ownerUserId: string;
      channelId: string;
      displayName: string;
      interests: string;
      introduction: string;
    }>,
  ): Promise<Introduction> {
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
      introductionId: string;
    }>,
  ): Promise<boolean> {
    const value = await this.dependencies.repository.getIntroduction(
      input.guildId.trim(),
      input.introductionId.trim(),
    );
    if (
      value === undefined ||
      value.ownerUserId !== input.ownerUserId.trim() ||
      value.status !== 'active'
    )
      return false;
    if (value.messageId?.trim())
      await this.dependencies.gateway.delete(value.channelId, value.messageId);
    return (
      (await this.dependencies.repository.updateIntroductionStatus(
        value.guildId,
        value.ownerUserId,
        value.id,
        'deleted',
        (this.dependencies.now ?? (() => new Date()))(),
      )) !== undefined
    );
  }
}

export const formatIntroduction = (
  value: Pick<Introduction, 'displayName' | 'interests' | 'introduction'>,
): string =>
  `🛸 **New crew signal: ${neutralizeDiscordMentions(value.displayName)}**\nInterests: ${neutralizeDiscordMentions(value.interests)}\nAboard because: ${neutralizeDiscordMentions(value.introduction)}`;

const bounded = (value: string, maximum: number): string | undefined => {
  const normalized = value.trim();
  return normalized.length >= 1 && normalized.length <= maximum
    ? normalized
    : undefined;
};
