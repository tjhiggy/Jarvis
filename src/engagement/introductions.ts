import type { Introduction } from './domain.js';
import type { EngagementRepository } from './storage.js';
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
  constructor(
    private readonly dependencies: Readonly<{
      repository: EngagementRepository;
      gateway: IntroductionGateway;
      rateLimiter: RateLimiter;
      createId: () => string;
      now?: () => Date;
    }>,
  ) {}

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
    if (
      (await this.dependencies.repository.findActiveIntroductionByOwner(
        guildId,
        ownerUserId,
      )) !== undefined
    )
      throw new IntroductionServiceError('duplicate');
    if (
      !this.dependencies.rateLimiter.consume(
        `introduction:${guildId}:${ownerUserId}`,
      ).allowed
    )
      throw new IntroductionServiceError('rate-limit');

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
    await this.dependencies.repository.createIntroduction(value);
    try {
      const message = await this.dependencies.gateway.post(
        channelId,
        formatIntroduction(value),
      );
      return (
        (await this.dependencies.repository.updateIntroductionMessageId(
          guildId,
          value.id,
          message.id,
        )) ?? value
      );
    } catch (error) {
      await this.dependencies.repository.updateIntroductionStatus(
        guildId,
        ownerUserId,
        value.id,
        'deleted',
        (this.dependencies.now ?? (() => new Date()))(),
      );
      throw error;
    }
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
