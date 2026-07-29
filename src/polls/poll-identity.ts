import { createHmac, randomBytes as cryptoRandomBytes } from 'node:crypto';

const base32Alphabet = 'abcdefghijklmnopqrstuvwxyz234567';

const encodeBase32 = (bytes: Uint8Array): string => {
  let buffer = 0;
  let bitCount = 0;
  let encoded = '';

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitCount += 8;

    while (bitCount >= 5) {
      bitCount -= 5;
      encoded += base32Alphabet[(buffer >>> bitCount) & 31];
    }

    buffer &= (1 << bitCount) - 1;
  }

  if (bitCount > 0) {
    encoded += base32Alphabet[(buffer << (5 - bitCount)) & 31];
  }

  return encoded;
};

export const createPollId = (
  randomBytes: (size: number) => Uint8Array = cryptoRandomBytes,
): string => encodeBase32(randomBytes(8)).slice(0, 12);

export const createVoterKey = (
  secret: string,
  guildId: string,
  pollId: string,
  userId: string,
): string =>
  createHmac('sha256', secret)
    .update(`${guildId}:${pollId}:${userId}`, 'utf8')
    .digest('hex');
