import { isAllowedChannel } from '../discord/permissions.js';

const massMentionPattern = /@(?:everyone|here)\b|<@&\d+>/i;
const linkPattern = /(?:https?:\/\/|www\.)\S+/i;

export class EngagementSafetyError extends Error {}

export const requirePlainText = (
  value: string,
  maximumLength: number,
  fieldName: string,
): string => {
  const text = value.trim();
  if (text === '') {
    throw new EngagementSafetyError(`${fieldName} is required.`);
  }
  if (text.length > maximumLength) {
    throw new EngagementSafetyError(
      `${fieldName} must be at most ${maximumLength} characters.`,
    );
  }
  if (massMentionPattern.test(text)) {
    throw new EngagementSafetyError(
      `${fieldName} cannot contain mass mentions.`,
    );
  }
  if (linkPattern.test(text)) {
    throw new EngagementSafetyError(`${fieldName} cannot contain links.`);
  }
  return text;
};

export interface EngagementComponentInteraction {
  readonly id: string;
  readonly guildId: string | null;
  readonly channelId: string;
  readonly userId: string;
}

export interface EngagementComponentRecord {
  readonly guildId: string;
  readonly channelId: string;
  readonly ownerUserId: string;
  readonly expiresAt: Date;
}

export interface EngagementInteractionClaimStore {
  claimIdempotencyKey(
    guildId: string,
    scope: 'interaction',
    key: string,
    createdAt: Date,
  ): Promise<boolean>;
}

export type EngagementComponentAuthorization =
  | { readonly authorized: true }
  | { readonly authorized: false; readonly reason: string };

export const verifyEngagementComponentAction = async (input: {
  readonly interaction: EngagementComponentInteraction;
  readonly record: EngagementComponentRecord;
  readonly allowedChannelIds: ReadonlySet<string>;
  readonly repository: EngagementInteractionClaimStore;
  readonly now: Date;
}): Promise<EngagementComponentAuthorization> => {
  const guildId = input.interaction.guildId?.trim();
  const channelId = input.interaction.channelId.trim();
  const userId = input.interaction.userId.trim();
  const interactionId = input.interaction.id.trim();

  if (
    guildId === undefined ||
    guildId === '' ||
    channelId === '' ||
    userId === '' ||
    interactionId === '' ||
    guildId !== input.record.guildId ||
    channelId !== input.record.channelId ||
    !isAllowedChannel(channelId, undefined, input.allowedChannelIds)
  ) {
    return { authorized: false, reason: 'This control is unavailable here.' };
  }
  if (userId !== input.record.ownerUserId) {
    return {
      authorized: false,
      reason: 'This control belongs to another member.',
    };
  }
  if (input.record.expiresAt.getTime() <= input.now.getTime()) {
    return { authorized: false, reason: 'This control has expired.' };
  }
  if (
    !(await input.repository.claimIdempotencyKey(
      guildId,
      'interaction',
      interactionId,
      input.now,
    ))
  ) {
    return { authorized: false, reason: 'This control was already used.' };
  }
  return { authorized: true };
};
