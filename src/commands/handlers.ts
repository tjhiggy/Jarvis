import type { ConversationResult } from '../services/conversation-service.js';
import type { ConversationStore } from '../storage/conversation-store.js';
import type { FaqCatalog } from '../faq/faq-catalog.js';
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
  readonly channel: Readonly<{
    parentId: string | null;
    isThread?(): boolean;
  }> | null;
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
    ai: Readonly<{ provider: 'openai' | 'ollama' }>;
    ollama: Readonly<{ baseUrl: string; model: string }>;
    webSearch: Readonly<{ apiKey: string }>;
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
      readonly webSearch?: boolean;
    }): Promise<ConversationResult>;
    clear(request: {
      readonly eventId: string;
      readonly guildId: string;
      readonly conversationId: string;
      readonly channelId: string;
      readonly userId: string;
    }): Promise<number>;
  }>;
  readonly store: Pick<ConversationStore, 'healthCheck'>;
  readonly faq: FaqCatalog;
}

const dmMessage = 'This command is available only in a server channel.';
const invalidInputMessage = 'Please provide a valid request.';
const disallowedMessage = 'This channel is not available for requests.';
const operationalErrorMessage =
  'The request could not be completed. Please try again later.';
const webSearchNotConfiguredMessage =
  'Web search is not configured on the MuthaShip.';
const unknownCommandMessage =
  'Unknown command. Use /help for available commands.';
const helpMessage = [
  '/ask prompt:<question> asks Jarvis a question.',
  '/search query:<question> searches current web sources before Jarvis answers.',
  '/forget clears Jarvis history in this channel or thread.',
  '/faq topic:<approved topic> browses approved Jarvis information.',
  '/help lists the available commands.',
  '/status reports safe service configuration and database health.',
  'Safety: Jarvis cannot administer or modify the server, cannot use tools or take external actions, and keeps history only for the current channel or thread.',
].join('\n');

export const handleCommand = async (
  interaction: CommandInteraction,
  dependencies: CommandDependencies,
): Promise<void> => {
  switch (interaction.commandName) {
    case 'ask':
      await handleAsk(interaction, dependencies, false);
      return;
    case 'search':
      await handleAsk(interaction, dependencies, true);
      return;
    case 'forget':
      await handleForget(interaction, dependencies);
      return;
    case 'faq':
      await handleFaq(interaction, dependencies);
      return;
    case 'help':
      if (await rejectDirectMessage(interaction)) {
        return;
      }
      await replySafely(interaction, helpMessage, true);
      return;
    case 'status':
      if (await rejectDirectMessage(interaction)) {
        return;
      }
      await handleStatus(interaction, dependencies);
      return;
    default:
      await replySafely(interaction, unknownCommandMessage, true);
  }
};

const rejectDirectMessage = async (
  interaction: CommandInteraction,
): Promise<boolean> => {
  if (interaction.guildId?.trim()) {
    return false;
  }
  await replySafely(interaction, dmMessage, true);
  return true;
};

const handleAsk = async (
  interaction: CommandInteraction,
  dependencies: CommandDependencies,
  forceWebSearch: boolean,
): Promise<void> => {
  const guildId = interaction.guildId?.trim();
  if (guildId === undefined || guildId === '') {
    await replySafely(interaction, dmMessage, true);
    return;
  }

  const channelId = interaction.channelId.trim();
  const parentChannelId = threadParentId(interaction);
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

  if (forceWebSearch && dependencies.config.webSearch.apiKey.trim() === '') {
    await replySafely(interaction, webSearchNotConfiguredMessage, true);
    return;
  }

  const prompt = interaction.options
    .getString(forceWebSearch ? 'query' : 'prompt')
    ?.trim();
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
      ...(forceWebSearch ? { webSearch: true } : {}),
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
  const parentChannelId = threadParentId(interaction);
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
    deleted = await dependencies.conversationService.clear({
      eventId: interaction.id,
      guildId,
      conversationId: channelId,
      channelId,
      userId: interaction.user.id,
    });
  } catch {
    await editDeferredReplySafely(interaction, operationalErrorMessage);
    return;
  }

  await editDeferredReplySafely(
    interaction,
    `Cleared ${deleted} conversation ${deleted === 1 ? 'message' : 'messages'} in this channel.`,
  );
};

const handleFaq = async (
  interaction: CommandInteraction,
  dependencies: CommandDependencies,
): Promise<void> => {
  if (await rejectDirectMessage(interaction)) {
    return;
  }

  const channelId = interaction.channelId.trim();
  const parentChannelId = threadParentId(interaction);
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

  const topic = interaction.options.getString('topic')?.trim();
  if (topic === undefined || topic === '') {
    await replySafely(
      interaction,
      `Choose an approved FAQ topic:\n${faqQuestions(dependencies.faq)}`,
    );
    return;
  }

  const entry = dependencies.faq.get(topic);
  if (entry === undefined) {
    await replySafely(
      interaction,
      `That FAQ topic is not available. Choose an approved FAQ topic:\n${faqLabels(dependencies.faq)}`,
    );
    return;
  }

  await replySafely(interaction, entry.answer);
};

const faqQuestions = (faq: FaqCatalog): string =>
  faq.entries.map((entry) => `- ${entry.question}`).join('\n');

const faqLabels = (faq: FaqCatalog): string =>
  faq.entries.map((entry) => `- ${entry.label}`).join('\n');

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
  const provider = dependencies.config.ai.provider;
  const aiConfigured =
    provider === 'openai'
      ? dependencies.config.openai.apiKey.trim() !== ''
      : dependencies.config.ollama.baseUrl.trim() !== '' &&
        dependencies.config.ollama.model.trim() !== '';

  await replySafely(
    interaction,
    [
      `Discord: ${discordConfigured ? 'configured' : 'not configured'}`,
      `Database: ${databaseHealthy ? 'healthy' : 'unhealthy'}`,
      `AI provider: ${provider === 'ollama' ? 'Ollama' : 'OpenAI'}`,
      `AI configuration: ${aiConfigured ? 'configured' : 'not configured'}`,
      `Web search: ${
        dependencies.config.webSearch.apiKey.trim() !== ''
          ? 'configured'
          : 'not configured'
      }`,
      'FAQ catalog: loaded',
    ].join('\n'),
    true,
  );
};

const resultMessage = (result: ConversationResult): string =>
  result.status === 'success' ? result.text : result.message;

const threadParentId = (interaction: CommandInteraction): string | undefined =>
  (interaction.channel?.isThread?.() ?? false)
    ? (interaction.channel?.parentId ?? undefined)
    : undefined;
