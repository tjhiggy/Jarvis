import { describe, expect, it } from 'vitest';
import {
  EngagementSafetyError,
  requirePlainText,
  verifyEngagementComponentAction,
} from '../src/engagement/safety.js';

describe('engagement safety', () => {
  it.each(['@everyone assemble', '@here now', '<@&123456789012345678>'])(
    'rejects mass mentions in plain text',
    (value) => {
      expect(() => requirePlainText(value, 80, 'title')).toThrow(
        EngagementSafetyError,
      );
    },
  );

  it('rejects links and overlong plain-text input', () => {
    expect(() => requirePlainText('https://example.test', 80, 'title')).toThrow(
      /links/i,
    );
    expect(() => requirePlainText('x'.repeat(81), 80, 'title')).toThrow(
      /80 characters/i,
    );
  });

  it('permits ordinary trimmed text', () => {
    expect(requirePlainText('  Movie night ideas  ', 80, 'title')).toBe(
      'Movie night ideas',
    );
  });

  it.each([
    ['stale component', { expiresAt: new Date('2026-08-08T11:59:59Z') }],
    ['wrong user', { ownerUserId: 'user-2' }],
    ['cross-guild component', { guildId: 'guild-2' }],
    ['wrong channel', { channelId: 'channel-2' }],
  ])('rejects a %s before claiming idempotency', async (_name, recordPatch) => {
    let claims = 0;

    const result = await verifyEngagementComponentAction({
      interaction: interaction(),
      record: { ...record(), ...recordPatch },
      allowedChannelIds: new Set(['channel-1']),
      repository: {
        claimIdempotencyKey: async () => {
          claims += 1;
          return true;
        },
      },
      now: new Date('2026-08-08T12:00:00Z'),
    });

    expect(result).toEqual({ authorized: false, reason: expect.any(String) });
    expect(claims).toBe(0);
  });

  it('allows the first owned, current component callback and blocks a duplicate', async () => {
    const claimed = new Set<string>();
    const repository = {
      claimIdempotencyKey: async (
        _guildId: string,
        _scope: 'interaction',
        key: string,
      ) => {
        if (claimed.has(key)) return false;
        claimed.add(key);
        return true;
      },
    };
    const input = {
      interaction: interaction(),
      record: record(),
      allowedChannelIds: new Set(['channel-1']),
      repository,
      now: new Date('2026-08-08T12:00:00Z'),
    };

    await expect(verifyEngagementComponentAction(input)).resolves.toEqual({
      authorized: true,
    });
    await expect(verifyEngagementComponentAction(input)).resolves.toEqual({
      authorized: false,
      reason: 'This control was already used.',
    });
  });
});

function interaction() {
  return {
    id: 'interaction-1',
    guildId: 'guild-1',
    channelId: 'channel-1',
    userId: 'user-1',
  };
}

function record() {
  return {
    guildId: 'guild-1',
    channelId: 'channel-1',
    ownerUserId: 'user-1',
    expiresAt: new Date('2026-08-08T12:01:00Z'),
  };
}
