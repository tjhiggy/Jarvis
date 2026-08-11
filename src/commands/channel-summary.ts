import type { ConversationMessage } from '../storage/conversation-store.js';
import { neutralizeDiscordMentions } from '../utils/mentions.js';

export const CHANNEL_SUMMARY_MESSAGE_LIMIT = 20;
export const CHANNEL_SUMMARY_WINDOW_MS = 24 * 60 * 60 * 1_000;

export const buildChannelSummary = (
  messages: readonly ConversationMessage[],
  now = new Date(),
): string => {
  const cutoff = now.getTime() - CHANNEL_SUMMARY_WINDOW_MS;
  const recent = messages
    .filter((message) => message.timestamp.getTime() >= cutoff)
    .slice(-CHANNEL_SUMMARY_MESSAGE_LIMIT);
  if (recent.length === 0) {
    return 'No recent Jarvis conversation is retained for this channel or thread.';
  }
  const lines = recent.map((message) => {
    const role = message.role === 'assistant' ? 'Jarvis' : 'Crew';
    const content = neutralizeDiscordMentions(
      message.content.replace(/\s+/g, ' ').trim(),
    ).slice(0, 280);
    return `• **${role}:** ${content}`;
  });
  return `**MuthaShip channel summary**\n_Last 24 hours of retained Jarvis conversation; no arbitrary Discord history was read._\n${lines.join('\n')}`;
};
