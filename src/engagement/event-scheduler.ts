import type { EngagementRepository } from './storage.js';
export interface EventReminderGateway {
  deliver(input: {
    eventId: string;
    guildId: string;
    channelId: string;
    userId: string;
    title: string;
    scheduledAt: Date;
    leaseToken: string;
    allowedMentions: { parse: readonly []; repliedUser: false };
  }): Promise<void>;
}
export class EventScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(
    private readonly dependencies: Readonly<{
      repository: Required<
        Pick<
          EngagementRepository,
          | 'claimDueEventReminders'
          | 'markEventReminderDelivered'
          | 'markEventReminderFailed'
        >
      > &
        Pick<EngagementRepository, 'cleanup'>;
      gateway: EventReminderGateway;
      now?: () => Date;
      intervalMs?: number;
    }>,
  ) {}
  start(): void {
    if (!this.timer)
      this.timer = setInterval(
        () => void this.tick(),
        this.dependencies.intervalMs ?? 60_000,
      );
  }
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
  async tick(): Promise<void> {
    const now = (this.dependencies.now ?? (() => new Date()))();
    for (const reminder of await this.dependencies.repository.claimDueEventReminders(
      now,
      100,
    )) {
      try {
        await this.dependencies.gateway.deliver({
          ...reminder,
          allowedMentions: { parse: [], repliedUser: false },
        });
        await this.dependencies.repository.markEventReminderDelivered(
          reminder.eventId,
          reminder.guildId,
          reminder.userId,
          reminder.leaseToken,
          now,
        );
      } catch {
        await this.dependencies.repository.markEventReminderFailed(
          reminder.eventId,
          reminder.guildId,
          reminder.userId,
          reminder.leaseToken,
          now,
        );
      }
    }
  }
}
