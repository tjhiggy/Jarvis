import { describe, expect, it } from 'vitest';
import { buildChannelSummary } from '../src/commands/channel-summary.js';

describe('channel summary', () => {
  it('summarizes only recent retained messages and neutralizes mentions', () => {
    const now = new Date('2026-08-09T12:00:00.000Z');
    const result = buildChannelSummary(
      [
        { id: 1, guildId: 'g', conversationId: 'c', userId: 'u', role: 'user', content: 'old', timestamp: new Date('2026-08-08T00:00:00.000Z') },
        { id: 2, guildId: 'g', conversationId: 'c', userId: 'u', role: 'user', content: 'Crew asks <@&123>', timestamp: new Date('2026-08-09T11:00:00.000Z') },
        { id: 3, guildId: 'g', conversationId: 'c', userId: 'u', role: 'assistant', content: 'Jarvis replies @everyone', timestamp: new Date('2026-08-09T11:01:00.000Z') },
      ],
      now,
    );

    expect(result).toContain('MuthaShip channel summary');
    expect(result).not.toContain('old');
    expect(result).toContain('@​everyone');
    expect(result).toContain('<@​&123>');
  });

  it('returns an unavailable message for empty or stale history', () => {
    expect(buildChannelSummary([], new Date('2026-08-09T12:00:00.000Z'))).toMatch(/no recent/i);
  });
});
