import { neutralizeDiscordMentions } from '../utils/mentions.js';
import type { ReminderView } from './reminder-types.js';

export interface ReminderMessagePayload {
  readonly content: string;
  readonly allowedMentions: Readonly<{
    readonly parse: readonly [];
    readonly users: readonly [string];
    readonly repliedUser: false;
  }>;
}

const maximumReminderTextLength = 500;
const maximumDiscordContentLength = 2_000;

export const renderReminderMessage = (
  reminder: ReminderView,
  now: Date,
): ReminderMessagePayload => {
  const ownerMention = `<@${reminder.ownerUserId}>`;
  const message = safeReminderText(reminder.message);
  const lateness = approximateLateness(reminder.dueAt, now);
  const content = truncateDiscordContent(
    lateness === undefined
      ? `${ownerMention} Reminder: ${message}`
      : `${ownerMention} Reminder from ${lateness} ago: ${message}`,
  );

  return Object.freeze({
    content,
    allowedMentions: Object.freeze({
      parse: Object.freeze([]) as readonly [],
      users: Object.freeze([reminder.ownerUserId]) as readonly [string],
      repliedUser: false,
    }),
  });
};

const safeReminderText = (message: string): string => {
  const neutralized = neutralizeDiscordMentions(
    message.slice(0, maximumReminderTextLength),
  ).trim();
  return neutralized === '' ? 'Reminder' : neutralized;
};

const approximateLateness = (dueAt: Date, now: Date): string | undefined => {
  const elapsed = now.getTime() - dueAt.getTime();
  if (!Number.isFinite(elapsed) || elapsed <= 0) return undefined;

  const minutes = Math.max(1, Math.round(elapsed / 60_000));
  if (minutes < 60) return `about ${pluralize(minutes, 'minute')}`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `about ${pluralize(hours, 'hour')}`;

  return `about ${pluralize(Math.round(hours / 24), 'day')}`;
};

const pluralize = (count: number, unit: string): string =>
  `${count} ${unit}${count === 1 ? '' : 's'}`;

const truncateDiscordContent = (value: string): string => {
  if (value.length <= maximumDiscordContentLength) return value;

  const suffix = '…';
  let result = '';
  for (const character of value) {
    if (
      result.length + character.length + suffix.length >
      maximumDiscordContentLength
    ) {
      break;
    }
    result += character;
  }
  return `${result}${suffix}`;
};
