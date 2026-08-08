import type { ConversationResult } from '../services/conversation-service.js';
import type { ConversationStore } from '../storage/conversation-store.js';
import type { FaqCatalog } from '../faq/faq-catalog.js';
import type { PollController } from '../polls/poll-controller.js';
import type { PollDurationValue } from '../polls/poll-duration.js';
import type { PollScheduler } from '../polls/poll-scheduler.js';
import type { PollStore } from '../polls/poll-store.js';
import {
  ReminderServiceError,
  type ReminderService,
} from '../reminders/reminder-service.js';
import type { ReminderScheduler } from '../reminders/reminder-scheduler.js';
import type { ReminderStore } from '../reminders/reminder-store.js';
import type { ReminderView } from '../reminders/reminder-types.js';
import type { RuntimeIdentity } from '../config/runtime-identity.js';
import type { SleeperService } from '../sleeper/sleeper-types.js';
import { isAllowedChannel } from '../discord/access.js';
import {
  allowedMentions,
  editDeferredReplySafely,
  replyImmediatelyInChunksSafely,
  replySafely,
  type DeferredReplyTarget,
  type ReplyPayload,
  type ReplyTarget,
} from '../discord/delivery.js';
import { chunkDiscordResponse } from '../utils/chunk-response.js';
import { neutralizeDiscordMentions } from '../utils/mentions.js';
import {
  handleIntroductionCommand,
  handleIntroductionDeletionCommand,
} from './introduction.js';
import type { IntroductionService } from '../engagement/introductions.js';
import type { SuggestionService } from '../engagement/suggestions.js';
import {
  handleSuggestionCommand,
  handleSuggestionDeletionCommand,
} from './suggestion.js';
import { handleEventCommand } from './event.js';
import type { EventService } from '../engagement/events.js';

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
  readonly member?: Readonly<{
    roles?: Readonly<{ cache?: Readonly<{ has(id: string): boolean }> }>;
  }> | null;
  readonly options: Readonly<{
    getSubcommand(): string;
    getString(name: string): string | null;
  }>;
  deferReply(payload: ReplyPayload): Promise<unknown>;
  fetchReply(): Promise<Readonly<{ id: string }>>;
}

export interface CommandDependencies {
  readonly config: Readonly<{
    runtimeIdentity?: RuntimeIdentity;
    discord: Readonly<{ token: string; clientId: string; guildId: string }>;
    openai: Readonly<{ apiKey: string }>;
    ai: Readonly<{ provider: 'openai' | 'ollama' }>;
    ollama: Readonly<{ baseUrl: string; model: string }>;
    webSearch: Readonly<{ apiKey: string }>;
    security: Readonly<{
      allowedChannelIds: ReadonlySet<string>;
      maxInputChars: number;
    }>;
    polls?: Readonly<{
      enabled: boolean;
      adminUserIds: ReadonlySet<string>;
    }>;
    engagement?: Readonly<{
      enabled: boolean;
      channels: Readonly<{
        introductionId: string;
        suggestionId: string;
        eventId: string;
      }>;
      adminRoleIds: ReadonlySet<string>;
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
  readonly reminderService: Pick<ReminderService, 'set' | 'list' | 'cancel'>;
  readonly reminderHealth: Readonly<{
    store: Pick<ReminderStore, 'healthCheck' | 'statusCounts'>;
    scheduler: Pick<ReminderScheduler, 'healthy'>;
  }>;
  readonly faq: FaqCatalog;
  readonly sleeper?: Readonly<{ leagueId: string; service: SleeperService }>;
  readonly pollController?: PollController;
  readonly pollHealth?: Readonly<{
    store: Pick<PollStore, 'healthCheck'>;
    scheduler: Pick<PollScheduler, 'healthy'>;
  }>;
  readonly introductionService?: IntroductionService;
  readonly suggestionService?: SuggestionService;
  readonly eventService?: EventService;
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
const pollsDisabledMessage =
  'Poll systems are not configured on the MuthaShip.';
const pollAdministratorMessage =
  'Poll creation and early closure are restricted to configured MuthaShip administrators.';
const pollInputMessage =
  'Please provide a valid poll question, options, and duration.';
const reminderInputMessage =
  'Please provide a valid duration and message (1 minute to 30 days, up to 500 characters).';
const reminderIdMessage = 'Please provide a valid 12-character reminder ID.';
const reminderActiveLimitMessage =
  'You already have 10 active reminders in this server. Cancel one before creating another.';
const reminderRateLimitMessage =
  'Too many reminder requests. Please try again shortly.';
const reminderNotFoundMessage =
  'That reminder was not found, you do not own it, or it can no longer be cancelled.';
const helpMessage = (pollsEnabled: boolean): string =>
  [
    '/ask prompt:<question> asks Jarvis a question.',
    '/search query:<question> searches current web sources before Jarvis answers.',
    '/forget clears Jarvis history in this channel or thread.',
    '/faq topic:<approved topic> browses approved Jarvis information.',
    '/reminder set in:<duration> message:<text> creates a private personal reminder request.',
    '/reminder list shows your retained reminders in this server.',
    '/reminder cancel id:<id> cancels one of your reminders.',
    'Reminder limits: 1 minute to 30 days, 500 characters, and 10 active reminders per server.',
    '/help lists the available commands.',
    '/status reports safe service configuration and database health.',
    ...(pollsEnabled
      ? [
          '/poll creates an anonymous 2-to-5-option poll for configured administrators.',
          '/poll-close poll_id:<id> closes a poll early for configured administrators.',
          'Members may vote anonymously and change their selection while a poll is open.',
        ]
      : ['Polls: not configured.']),
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
    case 'reminder':
      await handleReminder(interaction, dependencies);
      return;
    case 'fantasy':
      await handleFantasy(interaction, dependencies);
      return;
    case 'poll':
      await handlePoll(interaction, dependencies);
      return;
    case 'poll-close':
      await handlePollClose(interaction, dependencies);
      return;
    case 'introduce':
      await handleIntroductionCommand(interaction, {
        enabled: dependencies.config.engagement?.enabled ?? false,
        channelId:
          dependencies.config.engagement?.channels.introductionId ?? '',
        ...(dependencies.introductionService === undefined
          ? {}
          : { service: dependencies.introductionService }),
      });
      return;
    case 'introduction':
      await handleIntroductionDeletionCommand(
        interaction,
        dependencies.introductionService,
      );
      return;
    case 'suggest':
      await handleSuggestionCommand(interaction, {
        enabled: dependencies.config.engagement?.enabled ?? false,
        channelId: dependencies.config.engagement?.channels.suggestionId ?? '',
        ...(dependencies.suggestionService === undefined
          ? {}
          : { service: dependencies.suggestionService }),
      });
      return;
    case 'suggestion':
      await handleSuggestionDeletionCommand(
        interaction,
        dependencies.suggestionService,
      );
      return;
    case 'event':
      await handleEventCommand(interaction, {
        enabled: dependencies.config.engagement?.enabled ?? false,
        channelId: dependencies.config.engagement?.channels.eventId ?? '',
        adminRoleIds: dependencies.config.engagement?.adminRoleIds ?? new Set(),
        ...(dependencies.eventService === undefined
          ? {}
          : { service: dependencies.eventService }),
      });
      return;
    case 'help':
      if (await rejectDirectMessage(interaction)) {
        return;
      }
      await replySafely(
        interaction,
        helpMessage(pollsEnabled(dependencies)),
        true,
      );
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

const handleFantasy = async (
  interaction: CommandInteraction,
  dependencies: CommandDependencies,
): Promise<void> => {
  if (await rejectDirectMessage(interaction)) return;
  if (dependencies.sleeper === undefined) {
    await replySafely(
      interaction,
      'Sleeper league data is not configured on the MuthaShip.',
      true,
    );
    return;
  }
  if (interaction.options.getSubcommand() !== 'standings') {
    await replySafely(
      interaction,
      'Use `/fantasy standings` for the current read-only league standings.',
      true,
    );
    return;
  }
  try {
    const standings = await dependencies.sleeper.service.getStandings(
      dependencies.sleeper.leagueId,
    );
    const lines = standings.map(
      (standing, index) =>
        `${index + 1}. ${standing.ownerName ?? `Roster ${standing.rosterId}`} • ${standing.wins}-${standing.losses}-${standing.ties} • ${standing.pointsFor.toFixed(2)} PF`,
    );
    await replySafely(
      interaction,
      lines.length === 0
        ? 'Sleeper returned no standings yet.'
        : `MuthaShip league standings (read-only)\n${lines.join('\n')}`,
      true,
    );
  } catch {
    await replySafely(
      interaction,
      'Sleeper league data is temporarily unavailable. Jarvis will not guess.',
      true,
    );
  }
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

const handlePoll = async (
  interaction: CommandInteraction,
  dependencies: CommandDependencies,
): Promise<void> => {
  if (!pollsEnabled(dependencies)) {
    await replySafely(interaction, pollsDisabledMessage, true);
    return;
  }
  const scope = await authorizedPollScope(interaction, dependencies);
  if (scope === undefined) {
    return;
  }
  const question = interaction.options.getString('question') ?? '';
  const options = ['option1', 'option2', 'option3', 'option4', 'option5']
    .map((name) => interaction.options.getString(name))
    .filter(
      (option): option is string => option !== null && option.trim() !== '',
    );
  const duration = interaction.options.getString('duration') ?? '';
  if (
    !isPollDuration(duration) ||
    question.trim() === '' ||
    options.length < 2
  ) {
    await replySafely(interaction, pollInputMessage, true);
    return;
  }
  await interaction.deferReply({ ephemeral: false });
  try {
    await dependencies.pollController?.create({
      guildId: scope.guildId,
      conversationId: scope.channelId,
      channelId: scope.channelId,
      creatorUserId: interaction.user.id,
      question,
      options,
      duration,
      ...(scope.parentChannelId === undefined
        ? {}
        : { parentChannelId: scope.parentChannelId }),
      target: interaction,
    });
  } catch {
    await editDeferredReplySafely(interaction, operationalErrorMessage);
  }
};

const handleReminder = async (
  interaction: CommandInteraction,
  dependencies: CommandDependencies,
): Promise<void> => {
  const scope = await authorizedReminderScope(interaction, dependencies);
  if (scope === undefined) {
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  const subcommand = interaction.options.getSubcommand();
  try {
    switch (subcommand) {
      case 'set': {
        const reminder = await dependencies.reminderService.set({
          guildId: scope.guildId,
          channelId: scope.channelId,
          ownerUserId: interaction.user.id,
          duration: interaction.options.getString('in') ?? '',
          message: interaction.options.getString('message') ?? '',
          ...(scope.parentChannelId === undefined
            ? {}
            : { parentChannelId: scope.parentChannelId }),
        });
        await editDeferredReplySafely(
          interaction,
          `Reminder \`${reminder.id}\` set for ${discordTimestamp(reminder.dueAt)} in ${reminderDestination(reminder)}. Delivery depends on Jarvis retaining access to that location.`,
        );
        return;
      }
      case 'list': {
        const reminders = (
          await dependencies.reminderService.list({
            guildId: scope.guildId,
            ownerUserId: interaction.user.id,
          })
        ).filter(
          (reminder) =>
            reminder.guildId === scope.guildId &&
            reminder.ownerUserId === interaction.user.id,
        );
        await editPrivateDeferredReplyInChunksSafely(
          interaction,
          renderReminderList(reminders),
        );
        return;
      }
      case 'cancel': {
        const reminderId = interaction.options.getString('id')?.trim();
        if (reminderId === undefined || !/^[a-z2-7]{12}$/.test(reminderId)) {
          await editDeferredReplySafely(interaction, reminderIdMessage);
          return;
        }
        const reminder = await dependencies.reminderService.cancel({
          guildId: scope.guildId,
          ownerUserId: interaction.user.id,
          reminderId,
        });
        await editDeferredReplySafely(
          interaction,
          reminder === undefined
            ? reminderNotFoundMessage
            : `Reminder \`${reminder.id}\` status: ${reminderStatus(reminder)}.`,
        );
        return;
      }
      default:
        await editDeferredReplySafely(interaction, reminderInputMessage);
    }
  } catch (error) {
    await editDeferredReplySafely(interaction, reminderErrorMessage(error));
  }
};

const authorizedReminderScope = async (
  interaction: CommandInteraction,
  dependencies: CommandDependencies,
): Promise<
  | Readonly<{ guildId: string; channelId: string; parentChannelId?: string }>
  | undefined
> => {
  const guildId = interaction.guildId?.trim();
  if (guildId === undefined || guildId === '') {
    await replySafely(interaction, dmMessage, true);
    return undefined;
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
    return undefined;
  }
  return {
    guildId,
    channelId,
    ...(parentChannelId === undefined ? {} : { parentChannelId }),
  };
};

const reminderErrorMessage = (error: unknown): string => {
  if (!(error instanceof ReminderServiceError)) {
    return operationalErrorMessage;
  }
  switch (error.code) {
    case 'invalid-request':
      return reminderInputMessage;
    case 'active-limit':
      return reminderActiveLimitMessage;
    case 'rate-limit':
      return reminderRateLimitMessage;
  }
};

const renderReminderList = (reminders: readonly ReminderView[]): string => {
  if (reminders.length === 0) {
    return 'You have no retained reminders in this server.';
  }
  return [
    'Your retained reminders:',
    ...reminders.map(
      (reminder) =>
        `- \`${reminder.id}\` | ${discordTimestamp(reminder.dueAt)} | ${reminderDestination(reminder)} | ${reminderStatus(reminder)} | ${shortReminderText(reminder.message)}`,
    ),
  ].join('\n');
};

const editPrivateDeferredReplyInChunksSafely = async (
  interaction: CommandInteraction,
  content: string,
): Promise<void> => {
  const safeContent =
    neutralizeDiscordMentions(content).trim() || 'No response was available.';
  const chunks = chunkDiscordResponse(safeContent);
  await interaction.editReply({
    content: chunks[0] ?? 'No response was available.',
    allowedMentions,
  });
  for (const chunk of chunks.slice(1)) {
    await interaction.followUp({
      content: chunk,
      ephemeral: true,
      allowedMentions,
    });
  }
};

const discordTimestamp = (date: Date): string => {
  const seconds = Math.floor(date.getTime() / 1_000);
  return Number.isFinite(seconds) ? `<t:${seconds}:F>` : 'unknown time';
};

const reminderDestination = (reminder: ReminderView): string =>
  `<#${reminder.channelId}>`;

const reminderStatus = (reminder: ReminderView): string =>
  reminder.failureCategory === undefined
    ? reminder.status.replaceAll('_', ' ')
    : `${reminder.status.replaceAll('_', ' ')} (${formatReminderFailure(reminder.failureCategory)})`;

const formatReminderFailure = (
  category: NonNullable<ReminderView['failureCategory']>,
): string => {
  switch (category) {
    case 'unknown-channel':
      return 'destination unavailable';
    case 'permission':
      return 'destination access denied';
    case 'rate-limit':
      return 'rate limited';
    case 'network':
      return 'network failure';
    case 'service':
      return 'Discord service failure';
  }
};

const shortReminderText = (message: string): string => {
  const characters = Array.from(message.trim());
  return characters.length <= 96
    ? characters.join('')
    : `${characters.slice(0, 95).join('')}…`;
};

const handlePollClose = async (
  interaction: CommandInteraction,
  dependencies: CommandDependencies,
): Promise<void> => {
  if (!pollsEnabled(dependencies)) {
    await replySafely(interaction, pollsDisabledMessage, true);
    return;
  }
  if ((await authorizedPollScope(interaction, dependencies)) === undefined) {
    return;
  }
  const pollId = interaction.options.getString('poll_id')?.trim();
  if (pollId === undefined || !/^[a-z2-7]{12}$/.test(pollId)) {
    await replySafely(interaction, pollInputMessage, true);
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    await dependencies.pollController?.close({
      pollId,
      acknowledge: async (message) =>
        editDeferredReplySafely(interaction, message),
    });
  } catch {
    await editDeferredReplySafely(interaction, operationalErrorMessage);
  }
};

const authorizedPollScope = async (
  interaction: CommandInteraction,
  dependencies: CommandDependencies,
): Promise<
  | Readonly<{ guildId: string; channelId: string; parentChannelId?: string }>
  | undefined
> => {
  const guildId = interaction.guildId?.trim();
  if (guildId === undefined || guildId === '') {
    await replySafely(interaction, dmMessage, true);
    return undefined;
  }
  if (
    !dependencies.config.polls?.adminUserIds.has(interaction.user.id.trim())
  ) {
    await replySafely(interaction, pollAdministratorMessage, true);
    return undefined;
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
    return undefined;
  }
  return {
    guildId,
    channelId,
    ...(parentChannelId === undefined ? {} : { parentChannelId }),
  };
};

const pollsEnabled = (dependencies: CommandDependencies): boolean =>
  dependencies.config.polls?.enabled === true &&
  dependencies.pollController !== undefined;

const isPollDuration = (value: string): value is PollDurationValue =>
  value === '15m' ||
  value === '1h' ||
  value === '6h' ||
  value === '24h' ||
  value === '3d' ||
  value === '7d';

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
    await replyImmediatelyInChunksSafely(
      interaction,
      `Choose an approved FAQ topic:\n${faqQuestions(dependencies.faq)}`,
    );
    return;
  }

  const entry = dependencies.faq.get(topic);
  if (entry === undefined) {
    await replyImmediatelyInChunksSafely(
      interaction,
      `That FAQ topic is not available. Choose an approved FAQ topic:\n${faqLabels(dependencies.faq)}`,
    );
    return;
  }

  await replyImmediatelyInChunksSafely(interaction, entry.answer);
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
  const pollStatus = await getPollStatus(dependencies);
  const reminderStatus = await getReminderStatus(dependencies);

  await replySafely(
    interaction,
    [
      `Discord: ${discordConfigured ? 'configured' : 'not configured'}`,
      `Database: ${databaseHealthy ? 'healthy' : 'unhealthy'}`,
      `AI provider: ${provider === 'ollama' ? 'Ollama' : 'OpenAI'}`,
      `AI configuration: ${aiConfigured ? 'configured' : 'not configured'}`,
      ...(dependencies.config.runtimeIdentity === undefined
        ? []
        : [
            `Jarvis version: ${dependencies.config.runtimeIdentity.version} (${dependencies.config.runtimeIdentity.environment})`,
          ]),
      `Web search: ${
        dependencies.config.webSearch.apiKey.trim() !== ''
          ? 'configured'
          : 'not configured'
      }`,
      'FAQ catalog: loaded',
      ...reminderStatus,
      ...pollStatus,
    ].join('\n'),
    true,
  );
};

const getReminderStatus = async (
  dependencies: CommandDependencies,
): Promise<readonly string[]> => {
  const [storeHealthy, counts] = await Promise.all([
    dependencies.reminderHealth.store.healthCheck().catch(() => false),
    dependencies.reminderHealth.store.statusCounts().catch(() => undefined),
  ]);
  return [
    `Reminder store: ${storeHealthy ? 'healthy' : 'degraded'}`,
    `Reminder scheduler: ${dependencies.reminderHealth.scheduler.healthy ? 'healthy' : 'degraded'}`,
    counts === undefined
      ? 'Reminder counts: unavailable'
      : `Reminder counts: pending ${counts.pending}, retry pending ${counts.retryPending}, delivery uncertain ${counts.deliveryUncertain}, failed ${counts.failed}`,
  ];
};

const getPollStatus = async (
  dependencies: CommandDependencies,
): Promise<readonly string[]> => {
  if (!dependencies.config.polls?.enabled) {
    return ['Polls: not configured'];
  }
  if (
    dependencies.pollController === undefined ||
    dependencies.pollHealth === undefined
  ) {
    return ['Polls: unavailable'];
  }
  const databaseHealthy = await dependencies.pollHealth.store
    .healthCheck()
    .catch(() => false);
  return [
    'Polls: configured',
    `Poll database: ${databaseHealthy ? 'healthy' : 'unhealthy'}`,
    `Poll scheduler: ${dependencies.pollHealth.scheduler.healthy ? 'healthy' : 'degraded'}`,
  ];
};

const resultMessage = (result: ConversationResult): string =>
  result.status === 'success' ? result.text : result.message;

const threadParentId = (interaction: CommandInteraction): string | undefined =>
  (interaction.channel?.isThread?.() ?? false)
    ? (interaction.channel?.parentId ?? undefined)
    : undefined;
