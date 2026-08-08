import { GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import type { PollController } from '../polls/poll-controller.js';
import {
  SuggestionServiceError,
  type SuggestionModerationAction,
  type SuggestionService,
} from '../engagement/suggestions.js';
import { EventService, EventServiceError } from '../engagement/events.js';
import { isAllowedChannel } from './permissions.js';
import {
  replySafely,
  type ReplyPayload,
  type ReplyTarget,
} from './delivery.js';
import type { ConversationResult } from '../services/conversation-service.js';
import { EventDeduplicator } from '../security/event-deduplicator.js';
import { chunkDiscordResponse } from './response-chunking.js';
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
  isButton(): boolean;
}

interface DiscordButtonInteraction extends DiscordInteraction, ReplyTarget {
  readonly id: string;
  readonly customId: string;
  readonly guildId: string | null;
  readonly channelId: string;
  readonly channel: Readonly<{
    parentId: string | null;
    isThread?(): boolean;
  }> | null;
  readonly user: Readonly<{ id: string }>;
  readonly member?: Readonly<{
    roles?: Readonly<{ cache?: Readonly<{ has(roleId: string): boolean }> }>;
  }> | null;
  readonly message: Readonly<{
    id: string;
    guildId: string | null;
    channelId: string;
    author: Readonly<{ id: string }>;
  }>;
  deferReply(payload: ReplyPayload): Promise<unknown>;
  editReply(payload: ReplyPayload): Promise<unknown>;
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
  readonly pollController?: PollController;
  readonly suggestionService?: SuggestionService;
  readonly engagementAdminRoleIds?: ReadonlySet<string>;
  readonly suggestionChannelId?: string;
  readonly eventService?: EventService;
  readonly eventChannelId?: string;
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
): DiscordHandlers => {
  const pollButtonDeduplicator = new EventDeduplicator(10 * 60 * 1_000, 10_000);
  return {
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
      if (interaction.isChatInputCommand()) {
        await dependencies.handleCommand(interaction);
        return;
      }
      if (!interaction.isButton()) {
        return;
      }
      const button = interaction as DiscordButtonInteraction;
      const eventId = button.id.trim();
      if (eventId === '' || !pollButtonDeduplicator.accept(eventId)) {
        return;
      }
      try {
        if (button.customId.trim().startsWith('suggestion:v1:')) {
          await handleSuggestionButton(button, dependencies);
        } else if (button.customId.trim().startsWith('event:v1:')) {
          await handleEventButton(button, dependencies);
        } else {
          await handlePollButton(button, dependencies);
        }
      } catch (error) {
        pollButtonDeduplicator.release(eventId);
        throw error;
      }
    },
  };
};

export const parseEventCustomId = (
  customId: string,
):
  | {
      eventId: string;
      response: 'yes' | 'maybe' | 'no';
      reminderOptIn: boolean;
    }
  | undefined => {
  const match = /^event:v1:([a-zA-Z0-9-]{1,64}):(yes|maybe|no|remind)$/.exec(
    customId.trim(),
  );
  return match === null
    ? undefined
    : {
        eventId: match[1]!,
        response:
          match[2] === 'remind' ? 'yes' : (match[2]! as 'yes' | 'maybe' | 'no'),
        reminderOptIn: match[2] === 'remind',
      };
};
const handleEventButton = async (
  interaction: DiscordButtonInteraction,
  dependencies: MessageHandlerDependencies,
): Promise<void> => {
  const parsed = parseEventCustomId(interaction.customId);
  const guildId = interaction.guildId?.trim();
  const channelId = interaction.channelId.trim();
  if (
    !parsed ||
    !dependencies.eventService ||
    !guildId ||
    channelId !== dependencies.eventChannelId?.trim() ||
    interaction.message.guildId?.trim() !== guildId ||
    interaction.message.channelId.trim() !== channelId ||
    interaction.message.author.id.trim() !== dependencies.botUserId.trim()
  ) {
    await replySafely(interaction, 'This event control is unavailable.', true);
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    const rsvp = await dependencies.eventService.rsvp({
      guildId,
      eventId: parsed.eventId,
      userId: interaction.user.id,
      response: parsed.response,
      interactionId: interaction.id,
      reminderOptIn: parsed.reminderOptIn,
    });
    await interaction.editReply({
      content:
        rsvp.attendance === 'waitlisted'
          ? 'The confirmed seats are full. You are on the waitlist.'
          : `RSVP recorded: ${rsvp.response}.`,
      allowedMentions: { parse: [], repliedUser: false },
    });
  } catch (error) {
    const message =
      error instanceof EventServiceError && error.code === 'duplicate-action'
        ? 'This RSVP was already recorded.'
        : error instanceof EventServiceError && error.code === 'cancelled'
          ? 'This event is no longer accepting RSVPs.'
          : 'The RSVP could not be completed. Please retry later.';
    await interaction.editReply({
      content: message,
      allowedMentions: { parse: [], repliedUser: false },
    });
  }
};

export const parseSuggestionCustomId = (
  customId: string,
):
  | {
      readonly suggestionId: string;
      readonly action: SuggestionModerationAction;
    }
  | undefined => {
  const match =
    /^suggestion:v1:([a-zA-Z0-9-]{1,64}):(acknowledge|defer|resolve|archive)$/.exec(
      customId.trim(),
    );
  return match === null
    ? undefined
    : {
        suggestionId: match[1]!,
        action: match[2]! as SuggestionModerationAction,
      };
};

const handleSuggestionButton = async (
  interaction: DiscordButtonInteraction,
  dependencies: MessageHandlerDependencies,
): Promise<void> => {
  const parsed = parseSuggestionCustomId(interaction.customId);
  const guildId = interaction.guildId?.trim();
  const channelId = interaction.channelId.trim();
  if (
    parsed === undefined ||
    dependencies.suggestionService === undefined ||
    guildId === undefined ||
    guildId === '' ||
    channelId === '' ||
    channelId !== dependencies.suggestionChannelId?.trim() ||
    interaction.message.guildId?.trim() !== guildId ||
    interaction.message.channelId.trim() !== channelId ||
    interaction.message.author.id.trim() !== dependencies.botUserId.trim()
  ) {
    await replySafely(
      interaction,
      'This suggestion control is unavailable.',
      true,
    );
    return;
  }
  const roleIds = new Set<string>();
  for (const roleId of dependencies.engagementAdminRoleIds ?? []) {
    if (interaction.member?.roles?.cache?.has(roleId)) roleIds.add(roleId);
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    const updated = await dependencies.suggestionService.moderate({
      guildId,
      channelId,
      moderatorUserId: interaction.user.id,
      moderatorRoleIds: roleIds,
      suggestionId: parsed.suggestionId,
      action: parsed.action,
      interactionId: interaction.id,
    });
    await interaction.editReply({
      content: `Suggestion marked ${updated.status}.`,
      allowedMentions: { parse: [], repliedUser: false },
    });
  } catch (error) {
    const message =
      error instanceof SuggestionServiceError && error.code === 'forbidden'
        ? 'Suggestion controls are restricted to configured MuthaShip administrators.'
        : 'This suggestion control is unavailable.';
    await interaction.editReply({
      content: message,
      allowedMentions: { parse: [], repliedUser: false },
    });
  }
};

export const parsePollCustomId = (
  customId: string,
): { readonly pollId: string; readonly optionIndex: number } | undefined => {
  const match = /^poll:v1:([a-z2-7]{12}):([0-4])$/.exec(customId.trim());
  return match === null
    ? undefined
    : { pollId: match[1]!, optionIndex: Number(match[2]) };
};

const handlePollButton = async (
  interaction: DiscordButtonInteraction,
  dependencies: MessageHandlerDependencies,
): Promise<void> => {
  const parsed = parsePollCustomId(interaction.customId);
  if (parsed === undefined) {
    if (interaction.customId.trim().startsWith('poll:v1')) {
      await replySafely(interaction, 'This poll control is unavailable.', true);
    }
    return;
  }
  if (dependencies.pollController === undefined) {
    await replySafely(
      interaction,
      'Poll systems are not configured on the MuthaShip.',
      true,
    );
    return;
  }
  const guildId = interaction.guildId?.trim();
  const channelId = interaction.channelId.trim();
  const parentChannelId =
    interaction.channel?.isThread?.() === true
      ? interaction.channel.parentId?.trim()
      : undefined;
  if (
    guildId === undefined ||
    guildId === '' ||
    channelId === '' ||
    interaction.message.id.trim() === '' ||
    interaction.user.id.trim() === '' ||
    interaction.message.guildId?.trim() !== guildId ||
    interaction.message.channelId.trim() !== channelId ||
    interaction.message.author.id.trim() !== dependencies.botUserId.trim() ||
    !isAllowedChannel(
      channelId,
      parentChannelId,
      dependencies.allowedChannelIds,
    )
  ) {
    await replySafely(interaction, 'This poll control is unavailable.', true);
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  await dependencies.pollController.vote({
    pollId: parsed.pollId,
    guildId,
    channelId,
    messageId: interaction.message.id,
    voterUserId: interaction.user.id,
    optionIndex: parsed.optionIndex,
    acknowledge: async (message) =>
      interaction.editReply({
        content: neutralizeDiscordMentions(message),
        allowedMentions: { parse: [], repliedUser: false },
      }),
  });
};

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
