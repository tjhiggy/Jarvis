import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCommandDeckCutoverVerification } from '../scripts/verify-command-deck-cutover.js';

describe('Command Deck cutover disposable verification', () => {
  it('proves local fallback, live identity, token rotation, and origin denial', async () => {
    const directory = await mkdtemp(
      join(tmpdir(), 'jarvis-command-deck-cutover-'),
    );
    const receiptPath = join(directory, 'receipt.json');
    const receipt = await runCommandDeckCutoverVerification(receiptPath);

    expect(receipt.localFallback).toBe(true);
    expect(receipt.liveProjection).toBe(true);
    expect(receipt.redactionPassed).toBe(true);
    expect(receipt.scenarios).toEqual([
      { id: 'rotated_token', status: 401, code: 'unauthorized' },
      { id: 'origin_denied', status: 403, code: 'origin_denied' },
      { id: 'live_snapshot', status: 200, code: 'ok' },
    ]);
    const serialized = await readFile(receiptPath, 'utf8');
    expect(serialized).not.toMatch(
      /command-deck-cutover-secret-canary|authorization|remoteAddress/i,
    );
  });
});
