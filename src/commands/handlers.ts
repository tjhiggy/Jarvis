import type { ConversationResult } from '../services/conversation-service.js';
import type { ConversationStore } from '../storage/conversation-store.js';
import type { FaqCatalog } from '../faq/faq-catalog.js';
import type { ApprovedKnowledgeCatalog } from '../knowledge/approved-knowledge.js';
import type { SQLiteKnowledgeApprovalStore } from '../knowledge/knowledge-store.js';
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
import { formatRuntimeIdentity } from '../config/runtime-identity.js';
import type { SleeperService, SleeperMatchup } from '../sleeper/sleeper-types.js';
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
import { handleGameNightCommand } from './game-night.js';
import { handleLookingForGroupCommand } from './looking-for-group.js';
import type { EventService } from '../engagement/events.js';
import { handleRecapCommand } from './recap.js';
import type { RecapService } from '../engagement/recap.js';
import type { EngagementRepository } from '../engagement/storage.js';
import type { EngagementDeletionOutcome } from '../engagement/deletion.js';
import { handleTriviaCommand } from './activity.js';
import type { TriviaService } from '../engagement/activity.js';
import { handleEngagementCommand } from './engagement.js';
import type { EngagementSchedulerHealth } from '../engagement/health.js';
import type { BirthdayService } from '../engagement/birthdays.js';
import { buildEngagementCard, buildEngagementSelectMenu, toDiscordEngagementCard } from '../engagement/discord-ui.js';
import type { RoleMenuChoice } from '../engagement/role-menus.js';
import { buildChannelSummary } from './channel-summary.js';
import type { ProactiveEngagementService } from '../engagement/proactive.js';
import type { DelegatedPostService } from '../engagement/delegated-posts.js';
import { handleDelegatedPostCommand } from './delegated-post.js';
import type { GitHubReadOnlyService, GitHubServiceError } from '../github/github-service.js';

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
  readonly user: Readonly<{
    id: string;
    globalName?: string | null;
    username?: string;
  }>;
  readonly member?: Readonly<{
    displayName?: string | null;
    roles?: Readonly<{ cache?: Readonly<{ has(id: string): boolean }> }>;
  }> | null;
  readonly options: Readonly<{
    getSubcommand(): string;
    getString(name: string): string | null;
    getInteger?(name: string): number | null;
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
    github?: Readonly<{ owner: string; repo: string }>;
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
        recapId: string;
        activityId: string;
        birthdayId: string;
      }>;
      recapSchedule: string;
      retentionDays: number;
      adminRoleIds: ReadonlySet<string>;
      roleMenuChoices?: readonly RoleMenuChoice[];
    }>;
    sleeper?: Readonly<{ leagueId: string }>;
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
  readonly conversationHistory?: Pick<ConversationStore, 'getRecent'>;
  readonly reminderService: Pick<ReminderService, 'set' | 'list' | 'cancel'>;
  readonly reminderHealth: Readonly<{
    store: Pick<ReminderStore, 'healthCheck' | 'statusCounts'>;
    scheduler: Pick<ReminderScheduler, 'healthy'>;
  }>;
  readonly faq: FaqCatalog;
  readonly knowledge?: ApprovedKnowledgeCatalog;
  readonly knowledgeStore?: SQLiteKnowledgeApprovalStore;
  readonly sleeper?: Readonly<{ leagueId: string; service: SleeperService }>;
  readonly github?: Readonly<{ service: GitHubReadOnlyService }>;
  readonly pollController?: PollController;
  readonly pollHealth?: Readonly<{
    store: Pick<PollStore, 'healthCheck'>;
    scheduler: Pick<PollScheduler, 'healthy'>;
  }>;
  readonly introductionService?: IntroductionService;
  readonly suggestionService?: SuggestionService;
  readonly eventService?: EventService;
  readonly recapService?: RecapService;
  readonly recapRepository?: Required<
    Pick<EngagementRepository, 'setRecapEnabled'>
  >;
  readonly triviaService?: TriviaService;
  readonly birthdayService?: BirthdayService;
  readonly proactiveService?: ProactiveEngagementService;
  readonly delegatedPostService?: DelegatedPostService;
  readonly engagementHealth?: Readonly<{
    repository: Required<
      Pick<
        EngagementRepository,
        | 'engagementPaused'
        | 'setEngagementPaused'
        | 'healthCheck'
        | 'statusCounts'
      >
    > & {
      deleteOwnerData(
        guildId: string,
        userId: string,
      ): Promise<EngagementDeletionOutcome>;
    };
    schedulers?: Readonly<
      Record<string, EngagementSchedulerHealth | undefined>
    >;
  }>;
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
    '/knowledge query:<search> searches administrator-approved MuthaShip knowledge.',
    '/catch-me-up summarizes recent Jarvis conversation in this channel.',
    '/channel-summary summarizes retained Jarvis conversation from the last 24 hours in this channel or thread.',
    '/reminder set in:<duration> message:<text> creates a private personal reminder request.',
    '/reminder list shows your retained reminders in this server.',
    '/reminder cancel id:<id> cancels one of your reminders.',
    'Reminder limits: 1 minute to 30 days, 500 characters, and 10 active reminders per server.',
    '/help lists the available commands.',
    '/status reports safe service configuration and database health.',
    '/config shows administrators safe, non-secret Jarvis configuration.',
    '/engagement status, pause, resume, or delete provides scoped engagement operations.',
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
    case 'github':
      await handleGitHub(interaction, dependencies);
      return;
    case 'knowledge':
      await handleKnowledge(interaction, dependencies);
      return;
    case 'catch-me-up':
      await handleCatchMeUp(interaction, dependencies);
      return;
    case 'channel-summary':
      await handleChannelSummary(interaction, dependencies);
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
    case 'post':
      await handleDelegatedPostCommand(interaction, { enabled: dependencies.config.engagement?.enabled ?? false, channelId: dependencies.config.engagement?.channels.activityId ?? interaction.channelId, adminRoleIds: dependencies.config.engagement?.adminRoleIds ?? new Set(), ...(dependencies.delegatedPostService === undefined ? {} : { service: dependencies.delegatedPostService }) });
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
    case 'recap':
      await handleRecapCommand(interaction, {
        enabled: dependencies.config.engagement?.enabled ?? false,
        channelId: dependencies.config.engagement?.channels.recapId ?? '',
        adminRoleIds: dependencies.config.engagement?.adminRoleIds ?? new Set(),
        schedule: dependencies.config.engagement?.recapSchedule ?? '',
        ...(dependencies.recapService === undefined
          ? {}
          : { service: dependencies.recapService }),
        ...(dependencies.recapRepository === undefined
          ? {}
          : { repository: dependencies.recapRepository }),
      });
      return;
    case 'trivia':
      await handleTriviaCommand(interaction, {
        enabled: dependencies.config.engagement?.enabled ?? false,
        channelId: dependencies.config.engagement?.channels.activityId ?? '',
        retentionDays: dependencies.config.engagement?.retentionDays ?? 30,
        ...(dependencies.triviaService === undefined
          ? {}
          : { service: dependencies.triviaService }),
      });
      return;
    case 'game-night':
      await handleGameNightCommand(interaction, {
        enabled: dependencies.config.engagement?.enabled ?? false,
        channelId: dependencies.config.engagement?.channels.eventId ?? '',
        adminRoleIds: dependencies.config.engagement?.adminRoleIds ?? new Set(),
        ...(dependencies.eventService === undefined ? {} : { service: dependencies.eventService }),
      });
      return;
    case 'lfg':
      await handleLookingForGroupCommand(interaction, {
        enabled: dependencies.config.engagement?.enabled ?? false,
        channelId: dependencies.config.engagement?.channels.activityId ?? '',
      });
      return;
    case 'birthday': {
      if (!interaction.guildId || !dependencies.birthdayService) return replySafely(interaction, 'Birthday features are not configured on the MuthaShip.', true);
      const sub = interaction.options.getSubcommand();
      if (sub === 'delete') { await dependencies.birthdayService.remove(interaction.guildId, interaction.user.id); return replySafely(interaction, 'Your MuthaShip birthday has been deleted.', true); }
      if (sub === 'show') { const value = await dependencies.birthdayService.get(interaction.guildId, interaction.user.id); return replySafely(interaction, value ? `Your birthday is saved as ${String(value.month).padStart(2,'0')}-${String(value.day).padStart(2,'0')} (${value.timezone}).` : 'You have not opted in to birthday announcements.', true); }
      const date = interaction.options.getString('date') ?? '';
      const timezone = interaction.options.getString('timezone')?.trim() || 'UTC';
      try { await dependencies.birthdayService.set({ guildId: interaction.guildId, userId: interaction.user.id, date, timezone }); return replySafely(interaction, 'Your birthday is saved privately. Jarvis will announce it on the MuthaShip without revealing the date.', true); } catch { return replySafely(interaction, 'Birthday must use valid MM-DD format. No year is stored.', true); }
    }
    case 'engagement':
      if (interaction.options.getSubcommand() === 'proactive') {
        const proactive = dependencies.proactiveService;
        if (!proactive) return replySafely(interaction, 'Proactive engagement is not configured on the MuthaShip.', true);
        const action = interaction.options.getString('action') ?? 'status';
        if (action === 'preview') return replySafely(interaction, `Preview only. Nothing was posted.\n\n${await proactive.preview()}`, true);
        if (action === 'enable') { await proactive.setState('enabled'); return replySafely(interaction, 'Proactive MuthaShip posts enabled. Jarvis will post only to the configured channel, within quiet hours and rate limits.', true); }
        if (action === 'pause') { await proactive.setState('paused'); return replySafely(interaction, 'Proactive MuthaShip posts paused.', true); }
        const status = await proactive.status();
        return replySafely(interaction, `Proactive engagement: ${status.state}${status.lastPostedAt ? `\nLast post: ${status.lastPostedAt.toISOString()}` : ''}`, true);
      }
      await handleEngagementCommand(interaction, {
        enabled: dependencies.config.engagement?.enabled ?? false,
        adminRoleIds: dependencies.config.engagement?.adminRoleIds ?? new Set(),
        features: [
          ...(dependencies.config.engagement?.channels.introductionId
            ? ['introductions']
            : []),
          ...(dependencies.config.engagement?.channels.suggestionId
            ? ['suggestions']
            : []),
          ...(dependencies.config.engagement?.channels.eventId
            ? ['events']
            : []),
          ...(dependencies.config.engagement?.channels.activityId
            ? ['trivia']
            : []),
          ...(dependencies.config.engagement?.channels.recapId &&
          dependencies.config.engagement.recapSchedule
            ? ['recaps']
            : []),
        ],
        ...(dependencies.engagementHealth === undefined
          ? {}
          : dependencies.engagementHealth),
      });
      return;
    case 'help':
      if (await rejectDirectMessage(interaction)) {
        return;
      }
      await replySafely(interaction, helpMessage(pollsEnabled(dependencies)), true);
      return;
    case 'roles': {
      const choices = dependencies.config.engagement?.roleMenuChoices ?? [];
      if (choices.length === 0) return replySafely(interaction, 'Self-service crew roles are not configured on the MuthaShip.', true);
      const card = buildEngagementCard({ title: 'MuthaShip crew roles', description: 'Choose an optional role. Select the same role again to remove it.', components: [{ type: 'actionRow', components: [buildEngagementSelectMenu({ customId: 'roles:v1:select', placeholder: 'Choose a crew role', options: choices.map((choice) => ({ label: choice.label, value: choice.value })) })] }] });
      await interaction.reply(toDiscordEngagementCard(card));
      return;
    }
    case 'status':
      if (await rejectDirectMessage(interaction)) {
        return;
      }
      await handleStatus(interaction, dependencies);
      return;
    case 'config':
      await handleConfig(interaction, dependencies);
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
    const week = interaction.options.getInteger?.('week') ?? 1;
    try {
      const matchups = await dependencies.sleeper.service.getMatchups(dependencies.sleeper.leagueId, week);
      if (matchups.length === 0) {
        await replySafely(interaction, `Sleeper has no matchup data for week ${week}. The season may not have started yet.`, true);
        return;
      }
      const groups = new Map<number, SleeperMatchup[]>();
      for (const matchup of matchups) {
        if (matchup.matchupId === null) continue;
        const group = groups.get(matchup.matchupId) ?? [];
        group.push(matchup);
        groups.set(matchup.matchupId, group);
      }
      const lines = [...groups.entries()].map(([id, entries]) => {
        const sides = entries.map((entry) => `${entry.ownerName ?? `Roster ${entry.rosterId}`} ${entry.points.toFixed(2)}`).join(' vs ');
        return `Matchup ${id}: ${sides}`;
      });
      await replySafely(interaction, lines.length === 0
        ? `Sleeper has no completed matchups for week ${week}. Pre-draft or unassigned rosters are not guessed.`
        : `MuthaShip week ${week} matchups (read-only)\n${lines.join('\n')}`, true);
    } catch {
      await replySafely(interaction, 'Sleeper matchup data is temporarily unavailable. Jarvis will not guess.', true);
    }
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

const handleGitHub = async (interaction: CommandInteraction, dependencies: CommandDependencies): Promise<void> => {
  if (await rejectDirectMessage(interaction)) return;
  if (!dependencies.github) { await replySafely(interaction, 'GitHub repository data is not configured on the MuthaShip.', true); return; }
  try {
    const sub = interaction.options.getSubcommand();
    if (sub === 'repository') {
      const d = await dependencies.github.service.repository();
      await replySafely(interaction, `MuthaShip repository (read-only)\n${d.fullName}\n${d.description ?? 'No description'}\n⭐ ${d.stars} • ${d.openIssues} open issues • default branch ${d.defaultBranch}\n${d.url}`, true);
      return;
    }
    const number = interaction.options.getInteger?.('number') ?? 0;
    if (!Number.isSafeInteger(number) || number < 1) { await replySafely(interaction, 'Provide a valid GitHub issue or pull request number.', true); return; }
    const d = sub === 'issue' ? await dependencies.github.service.issue(number) : await dependencies.github.service.pullRequest(number);
    await replySafely(interaction, `GitHub ${d.kind} #${d.number} (read-only)\n${d.title}\nState: ${d.state} • Author: ${d.author}\nUpdated: ${d.updatedAt}\n${d.url}`, true);
  } catch (error) {
    const code = (error as GitHubServiceError).code;
    await replySafely(interaction, code === 'not-found' ? 'That GitHub item was not found.' : 'GitHub data is temporarily unavailable. Jarvis will not guess.', true);
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

const handleKnowledge = async (interaction: CommandInteraction, dependencies: CommandDependencies): Promise<void> => {
  if (await rejectDirectMessage(interaction)) return;
  const catalog = dependencies.knowledge;
  if (!catalog) return replySafely(interaction, 'Approved MuthaShip knowledge is not configured.', true);
  const subcommand = interaction.options.getSubcommand();
  const guildId = interaction.guildId?.trim() ?? '';
  const store = dependencies.knowledgeStore;
  if (subcommand !== 'query' && (!store || !guildId)) return replySafely(interaction, 'Knowledge administration is not configured.', true);
  if (subcommand !== 'query') {
    const isAdmin = [...(dependencies.config.engagement?.adminRoleIds ?? new Set())].some((role) => interaction.member?.roles?.cache?.has(role));
    if (!isAdmin) return replySafely(interaction, 'Only configured MuthaShip administrators can manage approved knowledge.', true);
    const id = interaction.options.getString('id')?.trim() ?? '';
    if (subcommand === 'list') {
      const entries = await store!.listForAdmin(guildId, catalog);
      return replySafely(interaction, entries.length === 0 ? 'No MuthaShip knowledge sources are configured.' : `MuthaShip knowledge sources (administrator view):\n${entries.map((entry) => `- ${entry.id}: ${entry.title} [${entry.active ? 'active' : entry.approved ? 'expired' : 'pending'}]`).join('\n')}`, true);
    }
    const changed = subcommand === 'approve' ? await store!.approve(guildId, id, catalog) : await store!.revoke(guildId, id, catalog);
    return replySafely(interaction, changed ? `Knowledge source \`${id}\` ${subcommand === 'approve' ? 'approved' : 'revoked'} for this MuthaShip.` : 'That catalog source is unavailable or expired.', true);
  }
  const query = interaction.options.getString('query')?.trim() ?? '';
  const results = store && guildId ? await store.search(guildId, query, catalog) : catalog.search(query);
  if (results.length === 0) return replySafely(interaction, 'No approved knowledge matches that query. Jarvis will not guess.', true);
  await replySafely(interaction, results.map((entry) => `**${entry.title}**\n${entry.content}\nSource: ${entry.source}`).join('\n\n'), true);
};

const handleCatchMeUp = async (
  interaction: CommandInteraction,
  dependencies: CommandDependencies,
): Promise<void> => {
  if (await rejectDirectMessage(interaction)) return;
  const channelId = interaction.channelId.trim();
  const guildId = interaction.guildId?.trim() ?? '';
  const parentChannelId = threadParentId(interaction);
  if (!guildId || !channelId || !isAllowedChannel(channelId, parentChannelId, dependencies.config.security.allowedChannelIds)) {
    await replySafely(interaction, disallowedMessage, true);
    return;
  }
  const historyStore = dependencies.conversationHistory;
  if (!historyStore) {
    await replySafely(interaction, 'Recent MuthaShip context is unavailable right now.', true);
    return;
  }
  try {
    const messages = await historyStore.getRecent(guildId, channelId, 12);
    if (messages.length === 0) {
      await replySafely(interaction, 'No recent Jarvis conversation is retained for this channel.', true);
      return;
    }
    const lines = messages.slice(-12).map((message) => {
      const role = message.role === 'assistant' ? 'Jarvis' : 'Crew';
      const content = message.content.replace(/\s+/g, ' ').trim().slice(0, 280);
      return `• **${role}:** ${neutralizeDiscordMentions(content)}`;
    });
    await replySafely(interaction, `**MuthaShip recent transmission log**\n${lines.join('\n')}`, true);
  } catch {
    await replySafely(interaction, 'Recent MuthaShip context is unavailable right now.', true);
  }
};

const handleChannelSummary = async (
  interaction: CommandInteraction,
  dependencies: CommandDependencies,
): Promise<void> => {
  if (await rejectDirectMessage(interaction)) return;
  const channelId = interaction.channelId.trim();
  const guildId = interaction.guildId?.trim() ?? '';
  const parentChannelId = threadParentId(interaction);
  if (!guildId || !channelId || !isAllowedChannel(channelId, parentChannelId, dependencies.config.security.allowedChannelIds)) {
    await replySafely(interaction, disallowedMessage, true);
    return;
  }
  const historyStore = dependencies.conversationHistory;
  if (!historyStore) {
    await replySafely(interaction, 'Recent MuthaShip context is unavailable right now.', true);
    return;
  }
  try {
    const messages = await historyStore.getRecent(guildId, channelId, 20);
    await replySafely(interaction, buildChannelSummary(messages), true);
  } catch {
    await replySafely(interaction, 'Recent MuthaShip context is unavailable right now.', true);
  }
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
            `Build identity: ${formatRuntimeIdentity(dependencies.config.runtimeIdentity)}`,
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

const maskDiscordId = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed === '') return 'not configured';
  return trimmed.length <= 4 ? 'configured' : `…${trimmed.slice(-4)}`;
};

const handleConfig = async (
  interaction: CommandInteraction,
  dependencies: CommandDependencies,
): Promise<void> => {
  if (await rejectDirectMessage(interaction)) return;
  const adminRoleIds = dependencies.config.engagement?.adminRoleIds ?? new Set<string>();
  const authorized = [...adminRoleIds].some((role) =>
    interaction.member?.roles?.cache?.has(role),
  );
  if (!authorized) {
    await replySafely(
      interaction,
      'Configuration details are restricted to configured MuthaShip administrators.',
      true,
    );
    return;
  }
  const config = dependencies.config;
  const engagement = config.engagement;
  const channels = engagement?.channels;
  const channelLines = channels
    ? [
        `  introductions: ${maskDiscordId(channels.introductionId)}`,
        `  suggestions: ${maskDiscordId(channels.suggestionId)}`,
        `  events: ${maskDiscordId(channels.eventId)}`,
        `  activity: ${maskDiscordId(channels.activityId)}`,
        `  recaps: ${maskDiscordId(channels.recapId)}`,
        `  birthdays: ${maskDiscordId(channels.birthdayId ?? '')}`,
      ]
    : ['  not configured'];
  const features = [
    engagement?.enabled ? 'engagement' : undefined,
    config.polls?.enabled ? 'polls' : undefined,
    config.webSearch.apiKey.trim() !== '' ? 'web search' : undefined,
    config.github ? 'GitHub read-only' : undefined,
    config.sleeper?.leagueId ? 'Sleeper read-only' : undefined,
    dependencies.knowledge ? 'approved knowledge' : undefined,
  ].filter((value): value is string => value !== undefined);
  const providerReady = config.ai.provider === 'openai'
    ? config.openai.apiKey.trim() !== ''
    : config.ollama.baseUrl.trim() !== '' && config.ollama.model.trim() !== '';
  await replySafely(
    interaction,
    [
      '**Jarvis safe configuration**',
      `Version: ${config.runtimeIdentity ? formatRuntimeIdentity(config.runtimeIdentity) : 'unknown'}`,
      `AI provider: ${config.ai.provider} (${providerReady ? 'ready' : 'not configured'})`,
      `Engagement: ${engagement?.enabled ? 'enabled' : 'disabled'}`,
      `Allowed request channels: ${config.security.allowedChannelIds.size === 0 ? 'all configured channels' : `${config.security.allowedChannelIds.size} configured`}`,
      `Enabled features: ${features.length > 0 ? features.join(', ') : 'none'}`,
      'Destination channels (IDs masked):',
      ...channelLines,
      'Secrets and tokens are intentionally omitted.',
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
