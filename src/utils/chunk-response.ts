const DEFAULT_DISCORD_LIMIT = 2_000;

const takeWithinLimit = (content: string, limit: number): string => {
  let length = 0;
  let end = 0;

  for (const character of content) {
    if (length + character.length > limit) {
      break;
    }

    length += character.length;
    end += character.length;
  }

  return content.slice(0, end);
};

const splitText = (content: string, limit: number): string[] => {
  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    const candidate = takeWithinLimit(remaining, limit);

    if (candidate.length === 0) {
      const character = Array.from(remaining)[0];
      if (character === undefined) {
        break;
      }

      chunks.push(character);
      remaining = remaining.slice(character.length);
      continue;
    }

    if (candidate.length === remaining.length) {
      chunks.push(candidate);
      break;
    }

    const separator = ['\n\n', '\n', ' '].find((value) =>
      candidate.lastIndexOf(value) > 0,
    );

    if (separator === undefined) {
      chunks.push(candidate);
      remaining = remaining.slice(candidate.length);
      continue;
    }

    const splitIndex = candidate.lastIndexOf(separator);
    chunks.push(candidate.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex + separator.length);
  }

  return chunks.filter((chunk) => chunk.length > 0);
};

const splitFencedBlock = (
  language: string,
  body: string,
  limit: number,
): string[] => {
  const openingFence = `\`\`\`${language}\n`;
  const closingFence = '\n```';
  const payloadLimit = limit - openingFence.length - closingFence.length;

  if (body.length === 0 && payloadLimit >= 0) {
    return [`${openingFence}${closingFence}`];
  }

  if (payloadLimit < 1) {
    return splitText(`${openingFence}${body}${closingFence}`, limit);
  }

  return splitText(body, payloadLimit).map(
    (chunk) => `${openingFence}${chunk}${closingFence}`,
  );
};

export const chunkDiscordResponse = (
  content: string,
  limit = DEFAULT_DISCORD_LIMIT,
): string[] => {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('Discord response chunk limit must be a positive integer.');
  }

  const chunks: string[] = [];
  const fencedBlockPattern = /```([^\r\n`]*)\r?\n([\s\S]*?)\r?\n```/g;
  let cursor = 0;

  for (const match of content.matchAll(fencedBlockPattern)) {
    const matchStart = match.index ?? 0;
    chunks.push(...splitText(content.slice(cursor, matchStart), limit));
    chunks.push(...splitFencedBlock(match[1] ?? '', match[2] ?? '', limit));
    cursor = matchStart + match[0].length;
  }

  chunks.push(...splitText(content.slice(cursor), limit));
  return chunks;
};
