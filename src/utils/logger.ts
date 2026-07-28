import type { Writable } from 'node:stream';
import pino, { type Logger } from 'pino';

const redacted = '[REDACTED]';
const sensitiveKey = /^(token|apiKey|authorization)$/i;

const redactLogObject = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => redactLogObject(item, seen));
  }

  if (typeof value !== 'object' || value === null) {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  const result: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    result[key] = sensitiveKey.test(key)
      ? redacted
      : redactLogObject(nestedValue, seen);
  }
  return result;
};

/** Creates structured logs without allowing credential-shaped fields to leak. */
export const createLogger = (level: string, stream?: Writable): Logger =>
  pino(
    {
      level,
      base: null,
      redact: {
        paths: [
          'token',
          'apiKey',
          'authorization',
          'headers.authorization',
          'headers.Authorization',
          'request.headers.authorization',
          'request.headers.Authorization',
        ],
        censor: redacted,
      },
      formatters: {
        log: (object) => redactLogObject(object) as Record<string, unknown>,
      },
    },
    stream,
  );
