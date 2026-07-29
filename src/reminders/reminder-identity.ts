import { randomBytes as cryptoRandomBytes } from 'node:crypto';

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

const createOpaqueId = (
  randomBytes: (size: number) => Buffer = cryptoRandomBytes,
): string => encodeBase32(randomBytes(16)).slice(0, 12);

export const createReminderId = createOpaqueId;
export const createReminderLeaseId = createOpaqueId;
