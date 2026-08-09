import { describe, expect, it } from 'vitest';
import { RecapService } from '../src/engagement/recap.js';

describe('recap privacy', () => {
  it('suppresses every low-volume metric and isolates the requested guild', async () => {
    const requested: string[] = [];
    const service = new RecapService({
      repository: {
        recapSource: async (guildId: string) => {
          requested.push(guildId);
          return {
            guildId,
            introductions: 2,
            suggestions: 1,
            events: 2,
            participantUserIds: ['u1', 'u2'],
            botActivity: 2,
          };
        },
      } as any,
    });
    const result = await service.preview('guild-a', {
      start: new Date('2026-08-01T00:00:00Z'),
      end: new Date('2026-08-08T00:00:00Z'),
    });
    expect(requested).toEqual(['guild-a']);
    expect(result.content).toContain('quiet week');
    expect(result.content).not.toMatch(
      /2 introductions|1 suggestions|2 events|u1|u2/,
    );
  });
});
