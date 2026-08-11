import { GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import type { PollController } from '../polls/poll-controller.js';
import {
  SuggestionServiceError,
  type SuggestionModerationAction,
  type SuggestionService,
} from '../engagement/suggestions.js';
import {
  IntroductionServiceError,
  type IntroductionService,
} from '../engagement/introductions.js';
import { EventService, EventServiceError } from '../engagement/events.js';
import { TriviaService, TriviaServiceError } from '../engagement/activity.js';
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
import {
  roleMenuSelection,
  type RoleMenuChoice,
} from '../engagement/role-menus.js';
import {
  MemberProfileServiceError,
  type MemberProfileService,
} from '../engagement/member-profiles.js';

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
  isStringSelectMenu?(): boolean;
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
  readonly user: Readonly<{ id: string; bot?: boolean }>;
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
  readonly introductionService?: IntroductionService;
  readonly suggestionService?: SuggestionService;
  readonly memberProfileService?: Pick<
    MemberProfileService,
    'confirm' | 'cancel'
  >;
  readonly engagementAdminRoleIds?: ReadonlySet<string>;
  readonly suggestionChannelId?: string;
  readonly eventService?: EventService;
  readonly eventChannelId?: string;
  readonly triviaService?: TriviaService;
  readonly activityChannelId?: string;
  readonly roleMenuChoices?: readonly RoleMenuChoice[];
  readonly onPreviewActionError?: (
    event: Readonly<{
      kind: 'introduction' | 'suggestion' | 'profile';
      guildId: string;
      draftId: string;
      code: string;
    }>,
  ) => void;
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
        if (interaction.isStringSelectMenu?.()) {
          await handleRoleMenu(interaction as any, dependencies);
        }
        return;
      }
      const button = interaction as DiscordButtonInteraction;
      const eventId = button.id.trim();
      if (eventId === '' || !pollButtonDeduplicator.accept(eventId)) {
        return;
      }
      try {
        if (button.customId.trim().startsWith('preview:v1:')) {
          await handlePreviewButton(button, dependencies);
        } else if (button.customId.trim().startsWith('suggestion:v1:')) {
          await handleSuggestionButton(button, dependencies);
        } else if (button.customId.trim().startsWith('event:v1:')) {
          await handleEventButton(button, dependencies);
        } else if (button.customId.trim().startsWith('trivia:v1:')) {
          await handleTriviaButton(button, dependencies);
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

const handleRoleMenu = async (
  interaction: Readonly<{
    customId: string;
    values: readonly string[];
    guildId: string | null;
    user: { id: string };
    member?: {
      roles?: {
        cache?: { has(roleId: string): boolean };
        add(roleId: string): Promise<unknown>;
        remove(roleId: string): Promise<unknown>;
      };
    } | null;
    reply(payload: ReplyPayload): Promise<unknown>;
  }>,
  dependencies: MessageHandlerDependencies,
): Promise<void> => {
  const value = interaction.values[0];
  const choice =
    value === undefined
      ? undefined
      : roleMenuSelection(dependencies.roleMenuChoices ?? [], value);
  if (
    !interaction.customId.startsWith('roles:v1:') ||
    !choice ||
    interaction.guildId === null ||
    !interaction.member?.roles
  ) {
    await interaction.reply({
      content: 'This crew role menu is unavailable.',
      ephemeral: true,
      allowedMentions: { parse: [], repliedUser: false },
    });
    return;
  }
  try {
    const currentlyAssigned =
      interaction.member.roles.cache?.has(choice.roleId) ?? false;
    if (currentlyAssigned) {
      await interaction.member.roles.remove(choice.roleId);
      await interaction.reply({
        content: `Crew role **${choice.label}** removed.`,
        ephemeral: true,
        allowedMentions: { parse: [], repliedUser: false },
      });
    } else {
      await interaction.member.roles.add(choice.roleId);
      await interaction.reply({
        content: `Crew role **${choice.label}** assigned.`,
        ephemeral: true,
        allowedMentions: { parse: [], repliedUser: false },
      });
    }
  } catch {
    await interaction.reply({
      content:
        'Jarvis could not update that crew role. Ask a MuthaShip administrator to verify role order and permissions.',
      ephemeral: true,
      allowedMentions: { parse: [], repliedUser: false },
    });
  }
};

export const parsePreviewCustomId = (
  customId: string,
):
  | {
      readonly kind: 'introduction' | 'suggestion' | 'profile';
      readonly draftId: string;
      readonly action: 'confirm' | 'cancel';
    }
  | undefined => {
  const match =
    /^preview:v1:(introduction|suggestion|profile):([a-zA-Z0-9-]{1,64}):(confirm|cancel)$/.exec(
      customId.trim(),
    );
  return match === null
    ? undefined
    : {
        kind: match[1]! as 'introduction' | 'suggestion' | 'profile',
        draftId: match[2]!,
        action: match[3]! as 'confirm' | 'cancel',
      };
};

const handlePreviewButton = async (
  interaction: DiscordButtonInteraction,
  dependencies: MessageHandlerDependencies,
): Promise<void> => {
  const parsed = parsePreviewCustomId(interaction.customId);
  const guildId = interaction.guildId?.trim();
  const channelId = interaction.channelId.trim();
  if (
    parsed === undefined ||
    guildId === undefined ||
    guildId === '' ||
    channelId === '' ||
    interaction.message.guildId?.trim() !== guildId ||
    interaction.message.channelId.trim() !== channelId ||
    interaction.message.author.id.trim() !== dependencies.botUserId.trim() ||
    (parsed.kind === 'introduction' &&
      dependencies.introductionService === undefined) ||
    (parsed.kind === 'suggestion' &&
      dependencies.suggestionService === undefined) ||
    (parsed.kind === 'profile' &&
      dependencies.memberProfileService === undefined)
  ) {
    await replySafely(
      interaction,
      'This preview is unavailable or expired.',
      true,
    );
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    if (parsed.action === 'cancel') {
      const cancelled =
        parsed.kind === 'profile'
          ? dependencies.memberProfileService!.cancel({
              serverId: guildId,
              ownerUserId: interaction.user.id,
              draftId: parsed.draftId,
            })
          : parsed.kind === 'introduction'
            ? dependencies.introductionService!.cancel({
                guildId,
                ownerUserId: interaction.user.id,
                draftId: parsed.draftId,
              })
            : dependencies.suggestionService!.cancel({
                guildId,
                ownerUserId: interaction.user.id,
                draftId: parsed.draftId,
              });
      await interaction.editReply({
        content: cancelled
          ? 'Preview cancelled. Nothing was saved or posted.'
          : 'This preview is unavailable or expired.',
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }
    const content =
      parsed.kind === 'profile'
        ? (await dependencies.memberProfileService!.confirm({
            serverId: guildId,
            ownerUserId: interaction.user.id,
            draftId: parsed.draftId,
          })) === null
          ? 'Member profile deleted.'
          : 'Member profile saved.'
        : parsed.kind === 'introduction'
          ? `Posted to the configured introduction channel. Your introduction ID is ${(await dependencies.introductionService!.confirm({ guildId, ownerUserId: interaction.user.id, draftId: parsed.draftId })).id}.`
          : `Posted to the configured suggestion channel. Your suggestion ID is ${(await dependencies.suggestionService!.confirm({ guildId, ownerUserId: interaction.user.id, draftId: parsed.draftId })).id}.`;
    await interaction.editReply({
      content,
      allowedMentions: { parse: [], repliedUser: false },
    });
  } catch (error) {
    const code =
      error instanceof IntroductionServiceError ||
      error instanceof SuggestionServiceError ||
      error instanceof MemberProfileServiceError
        ? error.code
        : 'unexpected';
    dependencies.onPreviewActionError?.({
      kind: parsed.kind,
      guildId,
      draftId: parsed.draftId,
      code,
    });
    const unavailable =
      (error instanceof IntroductionServiceError &&
        error.code === 'invalid-input') ||
      (error instanceof SuggestionServiceError &&
        error.code === 'invalid-input') ||
      (error instanceof MemberProfileServiceError &&
        ['invalid-input', 'expired', 'duplicate-action'].includes(error.code));
    await interaction.editReply({
      content: unavailable
        ? 'This preview is unavailable or expired.'
        : error instanceof IntroductionServiceError &&
            error.code === 'duplicate'
          ? 'You already have an active introduction. Remove it before posting another.'
          : error instanceof SuggestionServiceError &&
              error.code === 'duplicate'
            ? 'That suggestion is already awaiting triage.'
            : error instanceof MemberProfileServiceError &&
                error.code === 'duplicate'
              ? 'You already have a member profile. Use /profile edit, hide, or delete.'
              : error instanceof MemberProfileServiceError
                ? 'This profile preview could not be completed. Create a new private preview and try again.'
                : 'This preview could not be completed. Please retry with its UUID command.',
      allowedMentions: { parse: [], repliedUser: false },
    });
  }
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
export const parseTriviaCustomId = (
  customId: string,
): { readonly roundId: string; readonly answerIndex: number } | undefined => {
  const match = /^trivia:v1:([a-zA-Z0-9-]{1,64}):([0-3])$/.exec(
    customId.trim(),
  );
  return match === null
    ? undefined
    : { roundId: match[1]!, answerIndex: Number(match[2]) };
};
const handleTriviaButton = async (
  interaction: DiscordButtonInteraction,
  dependencies: MessageHandlerDependencies,
): Promise<void> => {
  const parsed = parseTriviaCustomId(interaction.customId);
  const guildId = interaction.guildId?.trim();
  const channelId = interaction.channelId.trim();
  if (
    !parsed ||
    !dependencies.triviaService ||
    !guildId ||
    channelId !== dependencies.activityChannelId?.trim() ||
    interaction.message.guildId?.trim() !== guildId ||
    interaction.message.channelId.trim() !== channelId ||
    interaction.message.author.id.trim() !== dependencies.botUserId.trim()
  )
    return replySafely(
      interaction,
      'This trivia control is unavailable.',
      true,
    );
  await interaction.deferReply({ ephemeral: true });
  try {
    const answer = await dependencies.triviaService.answer({
      guildId,
      channelId,
      roundId: parsed.roundId,
      userId: interaction.user.id,
      answerIndex: parsed.answerIndex,
      isBot: interaction.user.bot === true,
    });
    await interaction.editReply({
      content: answer.correct
        ? 'Answer recorded. Correct.'
        : 'Answer recorded. Not quite.',
      allowedMentions: { parse: [], repliedUser: false },
    });
  } catch (error) {
    const message =
      error instanceof TriviaServiceError && error.code === 'expired'
        ? await triviaResultsMessage(
            dependencies.triviaService,
            guildId,
            parsed.roundId,
          )
        : error instanceof TriviaServiceError &&
            error.code === 'duplicate-answer'
          ? 'You already answered this round.'
          : error instanceof TriviaServiceError && error.code === 'opted-out'
            ? 'You have opted out of engagement collection.'
            : 'This trivia control is unavailable.';
    await interaction.editReply({
      content: message,
      allowedMentions: { parse: [], repliedUser: false },
    });
  }
};
const triviaResultsMessage = async (
  service: TriviaService,
  guildId: string,
  roundId: string,
): Promise<string> => {
  try {
    const results = await service.results(guildId, roundId);
    return `Round closed: ${results.correctCount}/${results.participantCount} correct.`;
  } catch {
    return 'This trivia round has closed.';
  }
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
