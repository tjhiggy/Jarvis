const escapeRegularExpression = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const removeBotMention = (
  content: string,
  botUserId: string,
): string => {
  const escapedBotUserId = escapeRegularExpression(botUserId);
  const mentionPattern = new RegExp(`<@!?${escapedBotUserId}>`, 'g');

  return content.replace(mentionPattern, '').trim();
};

export const replaceUnverifiedUserMentions = (content: string): string =>
  content.replace(
    /<@!?\d+>/g,
    '[Discord member mentioned; verified profile details unavailable]',
  );

export const neutralizeDiscordMentions = (content: string): string =>
  content
    .replace(/@(?=everyone\b|here\b)/gi, '@\u200b')
    .replace(/<@(?=[!&]?\d+>)/g, '<@\u200b')
    .replace(/<#(?=\d+>)/g, '<#\u200b');
