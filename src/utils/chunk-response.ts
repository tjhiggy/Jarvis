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
      throw new RangeError(
        'Discord response chunk limit is too small for content.',
      );
    }

    if (candidate.length === remaining.length) {
      chunks.push(candidate);
      break;
    }

    const separator = ['\n\n', '\n', ' '].find(
      (value) => candidate.lastIndexOf(value) >= 0,
    );

    if (separator === undefined) {
      chunks.push(candidate);
      remaining = remaining.slice(candidate.length);
      continue;
    }

    const splitIndex = candidate.lastIndexOf(separator) + separator.length;
    chunks.push(candidate.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex);
  }

  return chunks;
};

const splitFencedBlock = (
  openingFence: string,
  body: string,
  closingFence: string | undefined,
  limit: number,
): string[] => {
  const syntheticClosingFence = '\n```';
  const maximumClosingLength = Math.max(
    syntheticClosingFence.length,
    closingFence?.length ?? 0,
  );
  const payloadLimit = limit - openingFence.length - maximumClosingLength;
  const original = `${openingFence}${body}${closingFence ?? ''}`;

  if (payloadLimit < 0) {
    return splitText(original, limit);
  }

  if (body.length === 0) {
    const closing = closingFence ?? syntheticClosingFence;
    return [`${openingFence}${closing}`];
  }

  let bodyChunks: string[];
  try {
    bodyChunks = splitText(body, payloadLimit);
  } catch (error) {
    if (error instanceof RangeError) {
      return splitText(original, limit);
    }
    throw error;
  }

  return bodyChunks.map((chunk, index) => {
    const isLastChunk = index === bodyChunks.length - 1;
    const closing =
      isLastChunk && closingFence !== undefined
        ? closingFence
        : syntheticClosingFence;

    return `${openingFence}${chunk}${closing}`;
  });
};

export const chunkDiscordResponse = (
  content: string,
  limit = DEFAULT_DISCORD_LIMIT,
): string[] => {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(
      'Discord response chunk limit must be a positive integer.',
    );
  }

  const chunks: string[] = [];
  const openingFencePattern = /```([^\r\n`]*)\r?\n/g;
  let cursor = 0;

  for (const openingMatch of content.matchAll(openingFencePattern)) {
    const openingIndex = openingMatch.index ?? 0;
    if (openingIndex < cursor) {
      continue;
    }

    chunks.push(...splitText(content.slice(cursor, openingIndex), limit));

    const openingFence = openingMatch[0];
    const bodyStart = openingIndex + openingFence.length;
    const closingFencePattern = /\r?\n```(?=\r?\n|$)/g;
    closingFencePattern.lastIndex = bodyStart;
    const closingMatch = closingFencePattern.exec(content);

    if (closingMatch === null) {
      chunks.push(
        ...splitFencedBlock(
          openingFence,
          content.slice(bodyStart),
          undefined,
          limit,
        ),
      );
      return chunks;
    }

    const closingIndex = closingMatch.index;
    chunks.push(
      ...splitFencedBlock(
        openingFence,
        content.slice(bodyStart, closingIndex),
        closingMatch[0],
        limit,
      ),
    );
    cursor = closingIndex + closingMatch[0].length;
  }

  chunks.push(...splitText(content.slice(cursor), limit));
  return chunks;
};
