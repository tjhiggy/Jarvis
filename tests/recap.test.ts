import { describe, expect, it } from 'vitest';
import { RecapService } from '../src/engagement/recap.js';

const week = {
  start: new Date('2026-08-01T00:00:00Z'),
  end: new Date('2026-08-08T00:00:00Z'),
};

describe('weekly recap', () => {
  it('renders bounded aggregate-only themed copy with an explicit source window', async () => {
    const service = new RecapService({
      repository: source({
        introductions: 3,
        suggestions: 4,
        events: 3,
        participants: ['a', 'b', 'c'],
        botActivity: 12,
      }),
    });
    const recap = await service.preview('guild-a', week);
    expect(recap.status).toBe('ready');
    expect(recap.content).toBeDefined();
    expect(recap.content).toContain('Weekly MuthaShip recap');
    expect(recap.content).toContain(
      'Source window: 2026-08-01 through 2026-08-08',
    );
    expect(recap.content).toContain('Data may be incomplete');
    expect(recap.content).toContain('3 introductions');
    expect(recap.content).toContain('4 suggestions');
    expect(recap.content).toContain('3 events');
    expect(recap.content).toContain('3 crew members participated');
    expect(recap.content!.length).toBeLessThanOrEqual(2_000);
    expect(recap.content).not.toContain('secret channel history');
  });

  it('reports a quiet week without inventing activity', async () => {
    const service = new RecapService({ repository: source() });
    await expect(service.preview('guild-a', week)).resolves.toMatchObject({
      status: 'quiet',
      content: expect.stringContaining('quiet week'),
    });
  });

  it('abstains when the configured record source is unavailable', async () => {
    const service = new RecapService({
      repository: {
        recapSource: async () => {
          throw new Error('closed');
        },
      } as any,
    });
    await expect(service.preview('guild-a', week)).resolves.toEqual({
      status: 'unavailable',
    });
  });
});

function source(
  values: Partial<{
    introductions: number;
    suggestions: number;
    events: number;
    participants: string[];
    botActivity: number;
  }> = {},
) {
  return {
    recapSource: async (guildId: string) => ({
      guildId,
      introductions: values.introductions ?? 0,
      suggestions: values.suggestions ?? 0,
      events: values.events ?? 0,
      participantUserIds: values.participants ?? [],
      botActivity: values.botActivity ?? 0,
    }),
  };
}
