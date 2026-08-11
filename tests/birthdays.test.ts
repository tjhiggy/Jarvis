import { describe, expect, it, vi } from 'vitest';
import {
  BirthdayScheduler,
  BirthdayService,
  parseBirthday,
} from '../src/engagement/birthdays.js';

describe('birthdays', () => {
  it('accepts month/day only and rejects years and invalid dates', () => {
    expect(parseBirthday('02-29')).toEqual({ month: 2, day: 29 });
    expect(() => parseBirthday('1990-02-01')).toThrow();
    expect(() => parseBirthday('02-31')).toThrow();
  });
  it('stores an opted-in birthday and supports deletion', async () => {
    const store = {
      get: vi.fn(),
      upsert: vi.fn(async (v) => v),
      delete: vi.fn(async () => true),
      due: vi.fn(),
      claimAnnouncement: vi.fn(),
    };
    const service = new BirthdayService(store);
    const result = await service.set({
      guildId: 'g',
      userId: 'u',
      date: '07-04',
      timezone: 'UTC',
    });
    expect(result).toMatchObject({ month: 7, day: 4, enabled: true });
    await expect(service.remove('g', 'u')).resolves.toBe(true);
  });
  it('announces once with no date disclosure', async () => {
    const store = {
      due: vi.fn(async () => [
        {
          guildId: 'g',
          userId: 'u',
          month: 7,
          day: 4,
          timezone: 'UTC',
          enabled: true,
          updatedAt: new Date(),
        },
      ]),
      claimAnnouncement: vi.fn(async () => true),
    };
    const announce = vi.fn();
    const scheduler = new BirthdayScheduler({
      store: store as never,
      gateway: { announce },
      guildId: 'g',
      channelId: 'c',
      timezone: 'UTC',
      now: () => new Date('2026-07-04T12:00:00Z'),
    });
    await scheduler.tick();
    expect(announce).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.not.stringMatching(/07-04|2026/),
        allowedMentions: { parse: [], repliedUser: false },
      }),
    );
  });
});
