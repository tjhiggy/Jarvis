import type { ConversationResult } from '../services/conversation-service.js';
import type { ConversationStore } from '../storage/conversation-store.js';
import { isAllowedChannel } from '../discord/access.js';
import {
  editDeferredReplySafely,
  replySafely,
  type DeferredReplyTarget,
  type ReplyPayload,
  type ReplyTarget,
} from '../discord/delivery.js';

export type { ReplyPayload } from '../discord/delivery.js';

export interface CommandInteraction extends ReplyTarget, DeferredReplyTarget {
  readonly id: string;
  readonly commandName: string;
  readonly guildId: string | null;
  readonly channelId: string;
  readonly channel: Readonly<{ parentId: string | null }> | null;
  readonly user: Readonly<{ id: string }>;
  readonly options: Readonly<{
    getString(name: string): string | null;
  }>;
  deferReply(payload: ReplyPayload): Promise<unknown>;
}

export interface CommandDependencies {
  readonly config: Readonly<{
    discord: Readonly<{ token: string; clientId: string; guildId: string }>;
    openai: Readonly<{ apiKey: string }>;
    security: Readonly<{
      allowedChannelIds: ReadonlySet<string>;
      maxInputChars: number;
    }>;
  }>;
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
  readonly store: Pick<ConversationStore, 'clear' | 'healthCheck'>;
}

const dmMessage = 'This command is available only in a server channel.';
const invalidInputMessage = 'Please provide a valid request.';
const disallowedMessage = 'This channel is not available for requests.';
const operationalErrorMessage =
  'The request could not be completed. Please try again later.';
const unknownCommandMessage =
  'Unknown command. Use /help for available commands.';
const helpMessage = [
  '/ask prompt:<question> asks Jarvis a question.',
  '/forget clears Jarvis history in this channel or thread.',
  '/help lists the available commands.',
  '/status reports safe service configuration and database health.',
].join('\n');

export const handleCommand = async (
  interaction: CommandInteraction,
  dependencies: CommandDependencies,
): Promise<void> => {
  switch (interaction.commandName) {
    case 'ask':
      await handleAsk(interaction, dependencies);
      return;
    case 'forget':
      await handleForget(interaction, dependencies);
      return;
    case 'help':
      await replySafely(interaction, helpMessage, true);
      return;
    case 'status':
      await handleStatus(interaction, dependencies);
      return;
    default:
      await replySafely(interaction, unknownCommandMessage, true);
  }
};

const handleAsk = async (
  interaction: CommandInteraction,
  dependencies: CommandDependencies,
): Promise<void> => {
  const guildId = interaction.guildId?.trim();
  if (guildId === undefined || guildId === '') {
    await replySafely(interaction, dmMessage, true);
    return;
  }

  const channelId = interaction.channelId.trim();
  const parentChannelId = interaction.channel?.parentId ?? undefined;
  if (
    channelId === '' ||
    !isAllowedChannel(
      channelId,
      parentChannelId,
      dependencies.config.security.allowedChannelIds,
    )
  ) {
    await replySafely(interaction, disallowedMessage, true);
    return;
  }

  const prompt = interaction.options.getString('prompt')?.trim();
  if (
    prompt === undefined ||
    prompt === '' ||
    Array.from(prompt).length > dependencies.config.security.maxInputChars
  ) {
    await replySafely(interaction, invalidInputMessage, true);
    return;
  }

  await interaction.deferReply({ ephemeral: false });
  let result: ConversationResult;
  try {
    result = await dependencies.conversationService.ask({
      eventId: interaction.id,
      guildId,
      conversationId: channelId,
      channelId,
      userId: interaction.user.id,
      prompt,
      ...(parentChannelId === undefined ? {} : { parentChannelId }),
    });
  } catch {
    await editDeferredReplySafely(interaction, operationalErrorMessage);
    return;
  }

  await editDeferredReplySafely(interaction, resultMessage(result));
};

const handleForget = async (
  interaction: CommandInteraction,
  dependencies: CommandDependencies,
): Promise<void> => {
  const guildId = interaction.guildId?.trim();
  if (guildId === undefined || guildId === '') {
    await replySafely(interaction, dmMessage, true);
    return;
  }

  const channelId = interaction.channelId.trim();
  const parentChannelId = interaction.channel?.parentId ?? undefined;
  if (
    channelId === '' ||
    !isAllowedChannel(
      channelId,
      parentChannelId,
      dependencies.config.security.allowedChannelIds,
    )
  ) {
    await replySafely(interaction, disallowedMessage, true);
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  let deleted: number;
  try {
    deleted = await dependencies.store.clear(guildId, channelId);
  } catch {
    await editDeferredReplySafely(interaction, operationalErrorMessage);
    return;
  }

  await editDeferredReplySafely(
    interaction,
    `Cleared ${deleted} conversation ${deleted === 1 ? 'message' : 'messages'} in this channel.`,
  );
};

const handleStatus = async (
  interaction: CommandInteraction,
  dependencies: CommandDependencies,
): Promise<void> => {
  const databaseHealthy = await dependencies.store
    .healthCheck()
    .catch(() => false);
  const discordConfigured = [
    dependencies.config.discord.token,
    dependencies.config.discord.clientId,
    dependencies.config.discord.guildId,
  ].every((value) => value.trim() !== '');
  const openAIConfigured = dependencies.config.openai.apiKey.trim() !== '';

  await replySafely(
    interaction,
    [
      `Discord: ${discordConfigured ? 'configured' : 'not configured'}`,
      `Database: ${databaseHealthy ? 'healthy' : 'unhealthy'}`,
      `OpenAI: ${openAIConfigured ? 'configured' : 'not configured'}`,
    ].join('\n'),
    true,
  );
};

const resultMessage = (result: ConversationResult): string =>
  result.status === 'success' ? result.text : result.message;
