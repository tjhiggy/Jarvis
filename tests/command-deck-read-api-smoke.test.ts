import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCommandDeckReadApiVerification } from '../scripts/verify-command-deck-read-api.js';

describe('Command Deck read API disposable verification', () => {
  it('writes a sanitized receipt for every accepted and denied path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jarvis-command-deck-'));
    const receiptPath = join(directory, 'receipt.json');
    const receipt = await runCommandDeckReadApiVerification(receiptPath);

    expect(receipt.redactionPassed).toBe(true);
    expect(receipt.scenarios).toEqual([
      { id: 'malformed', status: 400, code: 'invalid_request' },
      { id: 'unauthorized', status: 401, code: 'unauthorized' },
      { id: 'expired', status: 401, code: 'expired_request' },
      { id: 'cross_origin', status: 403, code: 'origin_denied' },
      { id: 'valid', status: 200, code: 'ok' },
      { id: 'replayed', status: 401, code: 'replayed_request' },
      { id: 'rate_limited', status: 429, code: 'rate_limited' },
    ]);
    const serialized = await readFile(receiptPath, 'utf8');
    expect(serialized).not.toMatch(
      /command-deck-secret-canary|authorization|remoteAddress/i,
    );
  });
});
