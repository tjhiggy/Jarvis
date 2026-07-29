import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { neutralizeDiscordMentions } from '../utils/mentions.js';
import type { PollOptionView, PollView } from './poll-types.js';

export interface PollMessagePayload {
  readonly embeds: readonly unknown[];
  readonly components: readonly unknown[];
  readonly allowedMentions: Readonly<{
    parse: readonly [];
    repliedUser: false;
  }>;
}

const safeAllowedMentions: PollMessagePayload['allowedMentions'] =
  Object.freeze({
    parse: Object.freeze([]) as readonly [],
    repliedUser: false,
  });

const pollCustomIdPrefix = 'poll:v1';
const maximumButtonLabelLength = 80;
const maximumEmbedDescriptionLength = 4_096;
const maximumEmbedFieldValueLength = 1_024;

export const createPollCustomId = (
  pollId: string,
  optionIndex: number,
): string => {
  if (!/^[a-z2-7]{12}$/.test(pollId)) {
    throw new RangeError('Poll ID cannot be rendered.');
  }
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 4) {
    throw new RangeError('Poll option cannot be rendered.');
  }
  return `${pollCustomIdPrefix}:${pollId}:${optionIndex}`;
};

export const renderPollMessage = (poll: PollView): PollMessagePayload =>
  renderPoll(poll, false);

export const renderUnavailablePollMessage = (
  poll: PollView,
): PollMessagePayload => renderPoll(poll, true);

const renderPoll = (
  poll: PollView,
  unavailable: boolean,
): PollMessagePayload => {
  const totalVotes = poll.options.reduce(
    (total, option) => total + safeVoteCount(option),
    0,
  );
  const isOpen = poll.status === 'active' && !unavailable;
  const closesAt = discordTimestamp(
    poll.closesAt,
    unavailable ? 'Closes' : undefined,
  );
  const closingText =
    poll.status === 'closed' && poll.closedAt !== undefined
      ? `Closed ${discordTimestamp(poll.closedAt, 'Closed')}`
      : `Closes ${closesAt}`;
  const description = unavailable
    ? `${safeText(poll.question, maximumEmbedDescriptionLength)}\n\n` +
      'Ship systems cannot synchronize this poll right now. Voting is temporarily unavailable.'
    : `${safeText(poll.question, maximumEmbedDescriptionLength)}\n\n` +
      `${closingText}\nAnonymous voting. You may change your selection while the poll is open.`;

  const embed = new EmbedBuilder()
    .setColor(unavailable ? 0x8b1e3f : isOpen ? 0x5d5fef : 0x5865f2)
    .setTitle(unavailable ? 'Muthaship Poll Unavailable' : 'Muthaship Poll')
    .setDescription(
      truncateDiscordText(description, maximumEmbedDescriptionLength),
    )
    .setFooter({ text: `Poll ID: ${poll.id} • ${totalVotes} participants` })
    .addFields(
      poll.options.map((option, position) =>
        renderOptionField(option, position, totalVotes),
      ),
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    poll.options.map((option) =>
      new ButtonBuilder()
        .setCustomId(createPollCustomId(poll.id, option.index))
        .setLabel(
          truncateDiscordText(
            safeText(option.label, maximumButtonLabelLength),
            maximumButtonLabelLength,
          ),
        )
        .setStyle(ButtonStyle.Primary)
        .setDisabled(!isOpen),
    ),
  );

  return Object.freeze({
    embeds: Object.freeze([embed]),
    components: Object.freeze([row]),
    allowedMentions: safeAllowedMentions,
  });
};

const renderOptionField = (
  option: PollOptionView,
  position: number,
  totalVotes: number,
): {
  readonly name: string;
  readonly value: string;
  readonly inline: false;
} => {
  const voteCount = safeVoteCount(option);
  const percentage =
    totalVotes === 0 ? 0 : Math.round((voteCount / totalVotes) * 100);
  const noun = voteCount === 1 ? 'vote' : 'votes';
  const details = `${voteCount} ${noun} • ${percentage}%`;
  const label = safeText(
    option.label,
    maximumEmbedFieldValueLength - details.length - 2,
  );

  return {
    name: `Option ${position + 1}`,
    value: truncateDiscordText(
      `${label}\n**${details}**`,
      maximumEmbedFieldValueLength,
    ),
    inline: false,
  };
};

const safeVoteCount = (option: PollOptionView): number =>
  Number.isSafeInteger(option.voteCount) && option.voteCount > 0
    ? option.voteCount
    : 0;

const safeText = (value: string, maximumLength: number): string => {
  const neutralized = neutralizeDiscordMentions(value).trim();
  return truncateDiscordText(
    neutralized === '' ? 'Untitled option' : neutralized,
    maximumLength,
  );
};

const discordTimestamp = (
  value: Date,
  style: 'Closed' | 'Closes' | undefined,
): string => {
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds)) {
    return style === 'Closed' ? 'at an unknown time' : 'at an unknown time';
  }
  const seconds = Math.floor(milliseconds / 1_000);
  return style === 'Closed' ? `<t:${seconds}:F>` : `<t:${seconds}:R>`;
};

const truncateDiscordText = (
  value: string,
  maximumCodeUnits: number,
): string => {
  if (value.length <= maximumCodeUnits) {
    return value;
  }

  const suffix = '…';
  let result = '';
  for (const character of value) {
    if (result.length + character.length + suffix.length > maximumCodeUnits) {
      break;
    }
    result += character;
  }
  return `${result}${suffix}`;
};
