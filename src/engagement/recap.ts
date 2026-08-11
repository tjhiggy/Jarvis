import type { EngagementRepository } from './storage.js';
import type { BroadcastPolicyService } from '../notifications/broadcast-policy.js';
import { projectOperationalError } from '../utils/logger.js';

const minimumGroupSize = 3;
const weekMs = 7 * 24 * 60 * 60 * 1_000;

export interface RecapWindow {
  readonly start: Date;
  readonly end: Date;
}
export interface RecapResult {
  readonly status: 'ready' | 'quiet' | 'unavailable';
  readonly content?: string;
}

type RecapRepository = Required<Pick<EngagementRepository, 'recapSource'>>;

export class RecapService {
  constructor(
    private readonly dependencies: Readonly<{ repository: RecapRepository }>,
  ) {}

  async preview(guildId: string, window: RecapWindow): Promise<RecapResult> {
    try {
      const source = await this.dependencies.repository.recapSource(
        guildId,
        window.start,
        window.end,
      );
      const lines = [
        `Weekly MuthaShip recap`,
        `Source window: ${day(window.start)} through ${day(window.end)}`,
      ];
      let hasVisibleActivity = false;
      if (source.introductions >= minimumGroupSize) {
        lines.push(`${source.introductions} introductions joined the crew.`);
        hasVisibleActivity = true;
      }
      if (source.suggestions >= minimumGroupSize) {
        lines.push(`${source.suggestions} suggestions entered the airlock.`);
        hasVisibleActivity = true;
      }
      if (source.events >= minimumGroupSize) {
        lines.push(`${source.events} events were on the ship's board.`);
        hasVisibleActivity = true;
      }
      const participants = new Set(source.participantUserIds).size;
      if (participants >= minimumGroupSize) {
        lines.push(`${participants} crew members participated.`);
        hasVisibleActivity = true;
      }
      if (source.botActivity >= minimumGroupSize) {
        lines.push(
          `${source.botActivity} bot-owned engagement updates were posted.`,
        );
        hasVisibleActivity = true;
      }
      if (!hasVisibleActivity)
        lines.push(
          'A quiet week on the MuthaShip. We are withholding low-volume detail to protect crew privacy.',
        );
      lines.push(
        'Data may be incomplete: this covers only configured engagement records and Jarvis-owned activity.',
      );
      return {
        status: hasVisibleActivity ? 'ready' : 'quiet',
        content: lines.join('\n'),
      };
    } catch {
      return { status: 'unavailable' };
    }
  }
}

export interface RecapGateway {
  post(channelId: string, content: string): Promise<void>;
}
export class RecapScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastRunValue: { status: 'success' | 'error'; at: Date } | undefined;
  private activeTick: Promise<void> | undefined;
  constructor(
    private readonly dependencies: Readonly<{
      guildId: string;
      channelId: string;
      schedule: string;
      timezone: string;
      repository: Required<
        Pick<
          EngagementRepository,
          | 'recapEnabled'
          | 'claimRecapRun'
          | 'completeRecapRun'
          | 'releaseRecapRun'
        >
      > &
        Pick<EngagementRepository, 'engagementPaused'>;
      service: RecapService;
      gateway: RecapGateway;
      policy: Pick<BroadcastPolicyService, 'evaluate'>;
      now?: () => Date;
      logger?: {
        warn(fields: Record<string, string | number>, message: string): void;
      };
    }>,
  ) {}
  get healthy(): boolean {
    return this.timer !== undefined;
  }
  get lastRun():
    Readonly<{ status: 'success' | 'error'; at: Date }> | undefined {
    return this.lastRunValue;
  }
  start(): void {
    if (!this.timer)
      this.timer = setInterval(
        () =>
          void this.tick().catch((error: unknown) =>
            this.dependencies.logger?.warn(
              {
                operation: 'recap_tick',
                ...projectOperationalError(error, 'recap_scheduler'),
              },
              'Recap tick failed.',
            ),
          ),
        60_000,
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
      if (!due(now, this.dependencies.schedule, this.dependencies.timezone))
        return;
      if (
        await this.dependencies.repository.engagementPaused?.(
          this.dependencies.guildId,
        )
      )
        return;
      if (!(await this.allowsDelivery(now))) return;
      if (
        !(await this.dependencies.repository.recapEnabled(
          this.dependencies.guildId,
        ))
      )
        return;
      const window = { start: new Date(now.getTime() - weekMs), end: now };
      const key = recapRunKey(
        now,
        this.dependencies.schedule,
        this.dependencies.timezone,
      );
      const leaseToken = await this.dependencies.repository.claimRecapRun(
        this.dependencies.guildId,
        key,
        now,
      );
      if (leaseToken === undefined) return;
      try {
        const recap = await this.dependencies.service.preview(
          this.dependencies.guildId,
          window,
        );
        if (recap.status === 'unavailable') return;
        if (
          await this.dependencies.repository.engagementPaused?.(
            this.dependencies.guildId,
          )
        )
          return;
        if (
          !(await this.allowsDelivery(
            (this.dependencies.now ?? (() => new Date()))(),
          ))
        )
          return;
        await this.dependencies.gateway.post(
          this.dependencies.channelId,
          recap.content!,
        );
        await this.dependencies.repository.completeRecapRun(
          this.dependencies.guildId,
          key,
          leaseToken,
          now,
        );
        this.lastRunValue = { status: 'success', at: now };
      } finally {
        await this.dependencies.repository.releaseRecapRun(
          this.dependencies.guildId,
          key,
          leaseToken,
          now,
        );
      }
    } catch (error) {
      this.lastRunValue = { status: 'error', at: now };
      this.dependencies.logger?.warn(
        {
          operation: 'recap_tick',
          ...projectOperationalError(error, 'recap_scheduler'),
        },
        'Recap tick failed.',
      );
    }
  }

  private async allowsDelivery(now: Date): Promise<boolean> {
    const globallyPaused =
      await this.dependencies.repository.engagementPaused?.(
        this.dependencies.guildId,
      );
    return (
      await this.dependencies.policy.evaluate({
        serverId: this.dependencies.guildId,
        category: 'recap',
        channelId: this.dependencies.channelId,
        now,
        ...(globallyPaused === undefined ? {} : { globallyPaused }),
      })
    ).allowed;
  }
}

const day = (value: Date): string => value.toISOString().slice(0, 10);
const recapRunKey = (now: Date, schedule: string, timezone: string): string => {
  const localDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const slot = schedule.slice(schedule.indexOf(' ') + 1);
  return `weekly-recap:${timezone}:${localDate}T${slot}`;
};
const due = (now: Date, schedule: string, timezone: string): boolean => {
  const match =
    /^(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY) ([0-2]\d):([0-5]\d)$/.exec(
      schedule,
    );
  if (!match) return false;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: string) =>
    parts.find((part) => part.type === type)?.value;
  if (value('weekday')?.toUpperCase() !== match[1]) return false;
  const current = Number(value('hour')) * 60 + Number(value('minute'));
  const scheduled = Number(match[2]) * 60 + Number(match[3]);
  return current >= scheduled;
};
