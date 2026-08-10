import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/config.js';

const validEnv = {
  DISCORD_TOKEN: 'discord-token',
  DISCORD_CLIENT_ID: '123',
  DISCORD_GUILD_ID: '456',
  OPENAI_API_KEY: 'openai-key',
};

describe('engagement configuration', () => {
  it('keeps engagement disabled with immutable empty channel and role settings when blank', () => {
    const engagement = loadConfig({
      ...validEnv,
      ENGAGEMENT_ENABLED: '',
      ENGAGEMENT_RECAP_SCHEDULE: '   ',
    }).engagement;

    expect(engagement).toEqual({
      enabled: false,
      channels: {
        introductionId: '',
        suggestionId: '',
        eventId: '',
        recapId: '',
        activityId: '',
        birthdayId: '',
        rssId: '',
      },
      rssAllowedHosts: [],
      adminRoleIds: expect.anything(),
      recapSchedule: '',
      recapTimezone: 'UTC',
      retentionDays: 30,
      maxRecordsPerUser: 5,
      maxParticipants: 100,
      roleMenuChoices: [],
    });
    expect([...engagement.adminRoleIds]).toEqual([]);
    expect(Object.isFrozen(engagement)).toBe(true);
    expect(Object.isFrozen(engagement.channels)).toBe(true);
  });

  it('loads validated configured engagement settings', () => {
    const engagement = loadConfig({
      ...validEnv,
      ENGAGEMENT_ENABLED: 'true',
      ENGAGEMENT_INTRODUCTION_CHANNEL_ID: '12345678901234567',
      ENGAGEMENT_SUGGESTION_CHANNEL_ID: '23456789012345678',
      ENGAGEMENT_EVENT_CHANNEL_ID: '34567890123456789',
      ENGAGEMENT_RECAP_CHANNEL_ID: '45678901234567890',
      ENGAGEMENT_ACTIVITY_CHANNEL_ID: '56789012345678901',
      ENGAGEMENT_ADMIN_ROLE_IDS: '67890123456789012, 78901234567890123',
      ENGAGEMENT_RECAP_SCHEDULE: 'MONDAY 09:30',
      ENGAGEMENT_RECAP_TIMEZONE: 'America/New_York',
      ENGAGEMENT_RETENTION_DAYS: '90',
      ENGAGEMENT_MAX_RECORDS_PER_USER: '8',
      ENGAGEMENT_MAX_PARTICIPANTS: '250',
    }).engagement;

    expect(engagement.enabled).toBe(true);
    expect(engagement.channels).toEqual({
      introductionId: '12345678901234567',
      suggestionId: '23456789012345678',
      eventId: '34567890123456789',
      recapId: '45678901234567890',
      activityId: '56789012345678901',
        birthdayId: '',
        rssId: '',
      });
    expect([...engagement.adminRoleIds]).toEqual([
      '67890123456789012',
      '78901234567890123',
    ]);
    expect(engagement.recapSchedule).toBe('MONDAY 09:30');
    expect(engagement.recapTimezone).toBe('America/New_York');
    expect(engagement.retentionDays).toBe(90);
    expect(engagement.maxRecordsPerUser).toBe(8);
    expect(engagement.maxParticipants).toBe(250);
  });

  it.each([
    ['ENGAGEMENT_INTRODUCTION_CHANNEL_ID', 'not-a-snowflake'],
    ['ENGAGEMENT_ADMIN_ROLE_IDS', '123'],
    ['ENGAGEMENT_RECAP_SCHEDULE', 'whenever'],
    ['ENGAGEMENT_RECAP_TIMEZONE', 'Mars/Olympus'],
  ])('rejects malformed %s values', (key, value) => {
    expect(() => loadConfig({ ...validEnv, [key]: value })).toThrow(
      new RegExp(key),
    );
  });

  it.each([
    ['ENGAGEMENT_RETENTION_DAYS', '0'],
    ['ENGAGEMENT_RETENTION_DAYS', '91'],
    ['ENGAGEMENT_MAX_RECORDS_PER_USER', '0'],
    ['ENGAGEMENT_MAX_RECORDS_PER_USER', '26'],
    ['ENGAGEMENT_MAX_PARTICIPANTS', '1'],
    ['ENGAGEMENT_MAX_PARTICIPANTS', '1001'],
  ])('rejects out-of-range %s values', (key, value) => {
    expect(() => loadConfig({ ...validEnv, [key]: value })).toThrow(
      new RegExp(key),
    );
  });

  it.each([
    {
      ENGAGEMENT_ENABLED: 'true',
      ENGAGEMENT_ADMIN_ROLE_IDS: '67890123456789012',
    },
    {
      ENGAGEMENT_ENABLED: 'true',
      ENGAGEMENT_INTRODUCTION_CHANNEL_ID: '12345678901234567',
    },
    {
      ENGAGEMENT_RECAP_SCHEDULE: 'MONDAY 09:30',
    },
  ])('rejects conflicting engagement settings', (engagementEnv) => {
    expect(() => loadConfig({ ...validEnv, ...engagementEnv })).toThrow(
      /ENGAGEMENT_(ENABLED|ADMIN_ROLE_IDS|INTRODUCTION_CHANNEL_ID|SUGGESTION_CHANNEL_ID|EVENT_CHANNEL_ID|RECAP_CHANNEL_ID|ACTIVITY_CHANNEL_ID|RECAP_SCHEDULE)/,
    );
  });
});
