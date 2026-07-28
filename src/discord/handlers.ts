import { GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { isAllowedChannel } from './access.js';
import { replySafely, type ReplyPayload } from './delivery.js';
import type { ConversationResult } from '../services/conversation-service.js';
import { chunkDiscordResponse } from '../utils/chunk-response.js';
import {
  neutralizeDiscordMentions,
  removeBotMention,
} from '../utils/mentions.js';

export const discordGatewayIntents = Object.freeze([
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
]);

interface PermissionSet {
  has(permission: bigint): boolean;
}

export interface DiscordMessage {
  readonly id: string;
  readonly content: string;
  readonly guildId: string | null;
  readonly channelId: string;
  readonly channel: Readonly<{
    parentId: string | null;
    permissionsFor(userId: string): PermissionSet | null;
  }>;
  readonly author: Readonly<{ id: string; bot: boolean }>;
  readonly mentions: Readonly<{
    users: Readonly<{ has(userId: string): boolean }>;
  }>;
  reply(payload: ReplyPayload): Promise<unknown>;
}

export interface DiscordInteraction {
  isChatInputCommand(): boolean;
}

interface EventDeduplicator {
  accept(eventId: string): boolean;
  release(eventId: string): void;
}

export interface MessageHandlerDependencies {
  readonly botUserId: string;
  readonly allowedChannelIds: ReadonlySet<string>;
  readonly conversationService: Readonly<{
    ask(request: {
      readonly eventId: string;
      readonly guildId: string;
      readonly conversationId: string;
      readonly channelId: string;
      readonly parentChannelId?: string;
      readonly userId: string;
      readonly prompt: string;
    }): Promise<ConversationResult>;
  }>;
  readonly deduplicator: EventDeduplicator;
  readonly handleCommand: (interaction: unknown) => Promise<void>;
}

export interface DiscordHandlers {
  onMessageCreate(message: DiscordMessage): Promise<void>;
  onInteractionCreate(interaction: DiscordInteraction): Promise<void>;
}

const requiredPermissions = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.SendMessages,
] as const;

const operationalErrorMessage =
  'The request could not be completed. Please try again later.';

export const createDiscordHandlers = (
  dependencies: MessageHandlerDependencies,
): DiscordHandlers => ({
  onMessageCreate: async (message) => {
    const normalized = normalizeMention(message, dependencies);
    if (normalized === undefined) {
      return;
    }

    if (!dependencies.deduplicator.accept(normalized.eventId)) {
      return;
    }

    try {
      const result = await dependencies.conversationService.ask(normalized);
      await replyInChunks(message, resultMessage(result));
    } catch {
      dependencies.deduplicator.release(normalized.eventId);
      await replyInChunks(message, operationalErrorMessage);
    }
  },
  onInteractionCreate: async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    await dependencies.handleCommand(interaction);
  },
});

interface NormalizedMention {
  readonly eventId: string;
  readonly guildId: string;
  readonly conversationId: string;
  readonly channelId: string;
  readonly parentChannelId?: string;
  readonly userId: string;
  readonly prompt: string;
}

const normalizeMention = (
  message: DiscordMessage,
  dependencies: MessageHandlerDependencies,
): NormalizedMention | undefined => {
  if (message.author.bot || message.guildId === null) {
    return undefined;
  }

  const eventId = message.id.trim();
  const guildId = message.guildId.trim();
  const channelId = message.channelId.trim();
  const userId = message.author.id.trim();
  const botUserId = dependencies.botUserId.trim();
  const parentChannelId = message.channel.parentId?.trim();
  if (
    eventId === '' ||
    guildId === '' ||
    channelId === '' ||
    userId === '' ||
    botUserId === '' ||
    !message.mentions.users.has(botUserId) ||
    !isAllowedChannel(
      channelId,
      parentChannelId,
      dependencies.allowedChannelIds,
    ) ||
    !hasRequiredPermissions(message, botUserId)
  ) {
    return undefined;
  }

  const prompt = removeBotMention(message.content, botUserId);
  if (prompt === '') {
    return undefined;
  }

  return {
    eventId,
    guildId,
    conversationId: channelId,
    channelId,
    userId,
    prompt,
    ...(parentChannelId === undefined || parentChannelId === ''
      ? {}
      : { parentChannelId }),
  };
};

const hasRequiredPermissions = (
  message: DiscordMessage,
  botUserId: string,
): boolean => {
  const permissions = message.channel.permissionsFor(botUserId);
  return (
    permissions !== null &&
    requiredPermissions.every((permission) => permissions.has(permission))
  );
};

const replyInChunks = async (
  target: Pick<DiscordMessage, 'reply'>,
  content: string,
): Promise<void> => {
  const safeContent = neutralizeDiscordMentions(content).trim();
  const chunks = chunkDiscordResponse(safeContent, 1_900);
  for (const chunk of chunks.length === 0
    ? ['No response was available.']
    : chunks) {
    await replySafely(target, chunk);
  }
};

const resultMessage = (result: ConversationResult): string =>
  result.status === 'success' ? result.text : result.message;
