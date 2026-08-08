import type { EngagementRepository } from './storage.js';
import { projectOperationalError } from '../utils/logger.js';
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
  private lastRunValue:
    | { status: 'success' | 'error'; at: Date }
    | undefined;
  private activeTick: Promise<void> | undefined;
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
        Pick<EngagementRepository, 'cleanup' | 'engagementPaused'>;
      gateway: EventReminderGateway;
      now?: () => Date;
      intervalMs?: number;
      logger?: { warn(fields: Record<string, string | number>, message: string): void };
    }>,
  ) {}
  get healthy(): boolean {
    return this.timer !== undefined;
  }
  get lastRun():
    | Readonly<{ status: 'success' | 'error'; at: Date }>
    | undefined {
    return this.lastRunValue;
  }
  start(): void {
    if (!this.timer)
      this.timer = setInterval(
        () => void this.tick().catch((error: unknown) => this.dependencies.logger?.warn({ operation: 'event_reminder_tick', ...projectOperationalError(error, 'event_scheduler') }, 'Event reminder tick failed.')),
        this.dependencies.intervalMs ?? 60_000,
      );
  }
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.activeTick;
  }
  async tick(): Promise<void> {
    if (this.activeTick) return this.activeTick;
    this.activeTick = this.runTick().finally(() => {
      this.activeTick = undefined;
    });
    return this.activeTick;
  }
  private async runTick(): Promise<void> {
    const now = (this.dependencies.now ?? (() => new Date()))();
    try {
      for (const reminder of await this.dependencies.repository.claimDueEventReminders(
        now,
        100,
      )) {
        try {
        if (await this.dependencies.repository.engagementPaused?.(reminder.guildId))
          continue;
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
        } catch (error) {
        this.dependencies.logger?.warn(
          {
            operation: 'event_reminder_delivery',
            guildId: reminder.guildId,
            eventId: reminder.eventId,
            ...projectOperationalError(error, 'event_reminder_delivery'),
          },
          'Event reminder delivery failed.',
        );
        await this.dependencies.repository.markEventReminderFailed(
          reminder.eventId,
          reminder.guildId,
          reminder.userId,
          reminder.leaseToken,
          now,
        );
        }
      }
      this.lastRunValue = { status: 'success', at: now };
    } catch (error) {
      this.lastRunValue = { status: 'error', at: now };
      throw error;
    }
  }
}
