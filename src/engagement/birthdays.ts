/** Privacy-first birthday primitives. No year is stored or accepted. */
import type { BroadcastPolicyService } from '../notifications/broadcast-policy.js';
import { projectOperationalError } from '../utils/logger.js';
export interface BirthdayRecord {
  readonly guildId: string;
  readonly userId: string;
  readonly month: number;
  readonly day: number;
  readonly timezone: string;
  readonly enabled: boolean;
  readonly updatedAt: Date;
}

export interface BirthdayStore {
  get(guildId: string, userId: string): Promise<BirthdayRecord | undefined>;
  upsert(record: BirthdayRecord): Promise<BirthdayRecord>;
  delete(guildId: string, userId: string): Promise<boolean>;
  due(
    guildId: string,
    month: number,
    day: number,
  ): Promise<readonly BirthdayRecord[]>;
  claimAnnouncement(
    guildId: string,
    month: number,
    day: number,
    userId: string,
  ): Promise<boolean>;
}

export const birthdayStoreFromRepository = (repository: {
  getBirthday(
    guildId: string,
    userId: string,
  ): Promise<BirthdayRecord | undefined>;
  saveBirthday(record: BirthdayRecord): Promise<BirthdayRecord>;
  deleteBirthday(guildId: string, userId: string): Promise<boolean>;
  listDueBirthdays(
    guildId: string,
    month: number,
    day: number,
  ): Promise<readonly BirthdayRecord[]>;
  claimBirthdayAnnouncement(
    guildId: string,
    month: number,
    day: number,
    userId: string,
  ): Promise<boolean>;
}): BirthdayStore => ({
  get: repository.getBirthday.bind(repository),
  upsert: repository.saveBirthday.bind(repository),
  delete: repository.deleteBirthday.bind(repository),
  due: repository.listDueBirthdays.bind(repository),
  claimAnnouncement: repository.claimBirthdayAnnouncement.bind(repository),
});

export interface BirthdayAnnouncementGateway {
  announce(input: {
    guildId: string;
    channelId: string;
    userId: string;
    /** Deliberately contains no date, year, or profile data. */
    content: string;
    allowedMentions: {
      parse: readonly [];
      users: readonly string[];
      repliedUser: false;
    };
  }): Promise<void>;
}

const daysInMonth = (month: number): number =>
  new Date(Date.UTC(2024, month, 0)).getUTCDate();

export const parseBirthday = (
  value: string,
): Pick<BirthdayRecord, 'month' | 'day'> => {
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(value.trim());
  if (!match)
    throw new Error('Birthday must use MM-DD format; year is not accepted.');
  const month = Number(match[1]);
  const day = Number(match[2]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(month))
    throw new Error('Birthday must be a valid calendar date.');
  return { month, day };
};

export const birthdayAnnouncement = (userId: string): string =>
  `<@${userId}> has a MuthaShip birthday today! Crew, send your best wishes.`;

export class BirthdayService {
  constructor(private readonly store: BirthdayStore) {}

  async set(
    input: Omit<BirthdayRecord, 'month' | 'day' | 'enabled' | 'updatedAt'> & {
      date: string;
      timezone: string;
    },
  ): Promise<BirthdayRecord> {
    const parsed = parseBirthday(input.date);
    return this.store.upsert({
      ...input,
      ...parsed,
      enabled: true,
      updatedAt: new Date(),
    });
  }
  async get(guildId: string, userId: string) {
    return this.store.get(guildId, userId);
  }
  async remove(guildId: string, userId: string) {
    return this.store.delete(guildId, userId);
  }
}

export class BirthdayScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;
  private active: Promise<void> | undefined;
  private lastRunValue: { status: 'success' | 'error'; at: Date } | undefined;
  constructor(
    private readonly dependencies: Readonly<{
      store: BirthdayStore;
      gateway: BirthdayAnnouncementGateway;
      guildId: string;
      channelId: string;
      timezone: string;
      policy: Pick<BroadcastPolicyService, 'evaluate'>;
      isGloballyPaused?: (guildId: string) => Promise<boolean>;
      now?: () => Date;
      intervalMs?: number;
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
                operation: 'birthday_tick',
                ...projectOperationalError(error, 'birthday_scheduler'),
              },
              'Birthday tick failed.',
            ),
          ),
        this.dependencies.intervalMs ?? 60_000,
      );
  }
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.active;
  }
  async tick(): Promise<void> {
    if (this.active) return this.active;
    this.active = this.run().finally(() => {
      this.active = undefined;
    });
    return this.active;
  }
  private async run(): Promise<void> {
    const now = this.dependencies.now?.() ?? new Date();
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: this.dependencies.timezone,
        month: 'numeric',
        day: 'numeric',
      }).formatToParts(now);
      const month = Number(parts.find((part) => part.type === 'month')?.value);
      const day = Number(parts.find((part) => part.type === 'day')?.value);
      for (const birthday of await this.dependencies.store.due(
        this.dependencies.guildId,
        month,
        day,
      )) {
        if (!(await this.allowsDelivery(birthday.userId, now))) continue;
        const content = birthdayAnnouncement(birthday.userId);
        if (
          !(await this.allowsDelivery(
            birthday.userId,
            this.dependencies.now?.() ?? new Date(),
          ))
        )
          continue;
        if (
          !(await this.dependencies.store.claimAnnouncement(
            this.dependencies.guildId,
            month,
            day,
            birthday.userId,
          ))
        )
          continue;
        await this.dependencies.gateway.announce({
          guildId: this.dependencies.guildId,
          channelId: this.dependencies.channelId,
          userId: birthday.userId,
          content,
          allowedMentions: {
            parse: [],
            users: [birthday.userId],
            repliedUser: false,
          },
        });
      }
      this.lastRunValue = { status: 'success', at: now };
    } catch (error) {
      this.lastRunValue = { status: 'error', at: now };
      this.dependencies.logger?.warn(
        {
          operation: 'birthday_tick',
          ...projectOperationalError(error, 'birthday_scheduler'),
        },
        'Birthday tick failed.',
      );
    }
  }

  private async allowsDelivery(userId: string, now: Date): Promise<boolean> {
    const globallyPaused = await this.dependencies.isGloballyPaused?.(
      this.dependencies.guildId,
    );
    return (
      await this.dependencies.policy.evaluate({
        serverId: this.dependencies.guildId,
        category: 'birthday',
        channelId: this.dependencies.channelId,
        userId,
        now,
        ...(globallyPaused === undefined ? {} : { globallyPaused }),
      })
    ).allowed;
  }
}
