import type { ConversationMessage } from '../storage/conversation-store.js';
import { neutralizeDiscordMentions } from '../utils/mentions.js';

const tokens = (value: string): readonly string[] =>
  value
    .toLocaleLowerCase('en-US')
    .normalize('NFKC')
    .match(/[\p{L}\p{N}]{2,}/gu) ?? [];

export const searchRetainedConversation = (
  messages: readonly ConversationMessage[],
  query: string,
): readonly string[] => {
  const queryTokens = [...new Set(tokens(query))];
  if (queryTokens.length === 0) return [];
  return messages
    .map((message) => {
      const contentTokens = tokens(message.content);
      const score = queryTokens.filter((token) =>
        contentTokens.some(
          (candidate) =>
            candidate === token ||
            (token.length >= 4 && candidate.startsWith(token)) ||
            (candidate.length >= 4 && token.startsWith(candidate)),
        ),
      ).length;
      return { message, score };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.message.timestamp.getTime() - left.message.timestamp.getTime(),
    )
    .slice(0, 5)
    .map(({ message }) => {
      const role = message.role === 'assistant' ? 'Jarvis' : 'Crew';
      const content = neutralizeDiscordMentions(
        message.content.replace(/\s+/g, ' ').trim(),
      ).slice(0, 280);
      return `• ${message.timestamp.toISOString()} · **${role}:** ${content}`;
    });
};
