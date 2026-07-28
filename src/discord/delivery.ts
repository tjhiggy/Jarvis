import { chunkDiscordResponse } from '../utils/chunk-response.js';
import { neutralizeDiscordMentions } from '../utils/mentions.js';

export interface AllowedMentions {
  readonly parse: readonly string[];
  readonly repliedUser: false;
}

export interface ReplyPayload {
  readonly content?: string;
  readonly ephemeral?: boolean;
  readonly allowedMentions?: AllowedMentions;
}

export interface ReplyTarget {
  reply(payload: ReplyPayload): Promise<unknown>;
}

export interface DeferredReplyTarget {
  editReply(payload: ReplyPayload): Promise<unknown>;
  followUp(payload: ReplyPayload): Promise<unknown>;
}

export const allowedMentions: AllowedMentions = Object.freeze({
  parse: Object.freeze([]),
  repliedUser: false,
});

const safeContent = (content: string): string => {
  const neutralized = neutralizeDiscordMentions(content).trim();
  return neutralized === '' ? 'No response was available.' : neutralized;
};

export const replySafely = async (
  target: ReplyTarget,
  content: string,
  ephemeral = false,
): Promise<void> => {
  await target.reply({
    content: safeContent(content),
    ephemeral,
    allowedMentions,
  });
};

export const editDeferredReplySafely = async (
  target: DeferredReplyTarget,
  content: string,
): Promise<void> => {
  const chunks = chunkDiscordResponse(safeContent(content));
  const firstChunk = chunks[0] ?? 'No response was available.';

  await target.editReply({ content: firstChunk, allowedMentions });
  for (const chunk of chunks.slice(1)) {
    await target.followUp({ content: chunk, allowedMentions });
  }
};
