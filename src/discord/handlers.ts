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
    isThread?(): boolean;
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
  readonly handleCommand: (interaction: unknown) => Promise<void>;
}

export interface DiscordHandlers {
  onMessageCreate(message: DiscordMessage): Promise<void>;
  onInteractionCreate(interaction: DiscordInteraction): Promise<void>;
}

const commonRequiredPermissions = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
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

    try {
      const result = await dependencies.conversationService.ask(normalized);
      await replyInChunks(message, resultMessage(result));
    } catch {
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
  const isThread = message.channel.isThread?.() ?? false;
  const parentChannelId = isThread
    ? message.channel.parentId?.trim()
    : undefined;
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
    !hasRequiredPermissions(message, botUserId, isThread)
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
  isThread: boolean,
): boolean => {
  const permissions = message.channel.permissionsFor(botUserId);
  return (
    permissions !== null &&
    commonRequiredPermissions.every((permission) =>
      permissions.has(permission),
    ) &&
    permissions.has(
      isThread
        ? PermissionFlagsBits.SendMessagesInThreads
        : PermissionFlagsBits.SendMessages,
    )
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
