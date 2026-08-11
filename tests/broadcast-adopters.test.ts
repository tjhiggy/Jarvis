import { describe, expect, it, vi } from 'vitest';
import { RecapScheduler, RecapService } from '../src/engagement/recap.js';
import { EventScheduler } from '../src/engagement/event-scheduler.js';
import { BirthdayScheduler } from '../src/engagement/birthdays.js';

const now = new Date('2026-08-10T12:00:00.000Z');
const allowThenPause = () => ({
  evaluate: vi
    .fn()
    .mockResolvedValueOnce({ allowed: true })
    .mockResolvedValueOnce({ allowed: false, reason: 'globally_paused' }),
});

describe('scheduled broadcast policy adopters', () => {
  it('rechecks policy immediately before recap delivery when a pause lands after preparation', async () => {
    const post = vi.fn();
    const policy = allowThenPause();
    const scheduler = new RecapScheduler({
      guildId: 'server-1',
      channelId: 'recaps',
      schedule: 'MONDAY 12:00',
      timezone: 'UTC',
      repository: {
        recapEnabled: async () => true,
        claimRecapRun: async () => 'recap-lease',
        completeRecapRun: async () => true,
        releaseRecapRun: async () => true,
      } as any,
      service: new RecapService({
        repository: {
          recapSource: async () => ({
            guildId: 'server-1',
            introductions: 3,
            suggestions: 0,
            events: 0,
            participantUserIds: [],
            botActivity: 0,
          }),
        },
      }),
      gateway: { post },
      policy,
      now: () => now,
    });

    await scheduler.tick();

    expect(post).not.toHaveBeenCalled();
    expect(policy.evaluate).toHaveBeenCalledTimes(2);
  });

  it('rechecks policy immediately before event reminder delivery when a pause lands after preparation', async () => {
    const deliver = vi.fn();
    const policy = allowThenPause();
    await new EventScheduler({
      repository: {
        claimDueEventReminders: async () => [
          {
            eventId: 'event-1',
            guildId: 'server-1',
            channelId: 'events',
            userId: 'crew-1',
            title: 'Boarding',
            scheduledAt: now,
            leaseToken: 'event-lease',
          },
        ],
        markEventReminderDelivered: async () => true,
        markEventReminderFailed: async () => true,
      } as any,
      gateway: { deliver },
      policy,
      now: () => now,
    }).tick();

    expect(deliver).not.toHaveBeenCalled();
    expect(policy.evaluate).toHaveBeenCalledTimes(2);
  });

  it('releases a policy-suppressed event reminder claim so it remains retryable', async () => {
    const release = vi.fn().mockResolvedValue(true);
    const markFailed = vi.fn();
    await new EventScheduler({
      repository: {
        claimDueEventReminders: async () => [
          {
            eventId: 'event-1',
            guildId: 'server-1',
            channelId: 'events',
            userId: 'crew-1',
            title: 'Boarding',
            scheduledAt: now,
            leaseToken: 'event-lease',
          },
        ],
        markEventReminderDelivered: async () => true,
        markEventReminderFailed: markFailed,
        releaseEventReminder: release,
      } as never,
      gateway: { deliver: vi.fn() },
      policy: {
        evaluate: vi
          .fn()
          .mockResolvedValue({ allowed: false, reason: 'member_not_opted_in' }),
      },
      now: () => now,
    }).tick();

    expect(release).toHaveBeenCalledWith(
      'event-1',
      'server-1',
      'crew-1',
      'event-lease',
      now,
    );
    expect(markFailed).not.toHaveBeenCalled();
  });

  it('does not announce a birthday when the member preference is missing', async () => {
    const announce = vi.fn();
    const policy = {
      evaluate: vi
        .fn()
        .mockResolvedValue({ allowed: false, reason: 'member_not_opted_in' }),
    };
    await new BirthdayScheduler({
      store: {
        due: async () => [
          {
            guildId: 'server-1',
            userId: 'crew-1',
            month: 8,
            day: 10,
            timezone: 'UTC',
            enabled: true,
            updatedAt: now,
          },
        ],
        claimAnnouncement: async () => true,
      } as never,
      gateway: { announce },
      guildId: 'server-1',
      channelId: 'birthdays',
      timezone: 'UTC',
      policy,
      now: () => now,
    }).tick();

    expect(announce).not.toHaveBeenCalled();
    expect(policy.evaluate).toHaveBeenCalledTimes(1);
  });
});
