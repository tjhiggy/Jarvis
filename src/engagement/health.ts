export type SchedulerLastRunStatus = 'success' | 'error' | 'never';

export interface EngagementSchedulerHealth {
  readonly healthy: boolean;
  readonly lastRun?:
    | Readonly<{
        status: Exclude<SchedulerLastRunStatus, 'never'>;
        at: Date;
      }>
    | undefined;
}

export interface EngagementRecordCounts {
  readonly introductions: number;
  readonly suggestions: number;
  readonly events: number;
  readonly rsvps: number;
  readonly triviaRounds: number;
}

export interface EngagementHealth {
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly database: 'healthy' | 'degraded' | 'unavailable';
  readonly recordCounts: EngagementRecordCounts | 'unavailable';
  readonly schedulers: Readonly<
    Record<
      string,
      Readonly<{
        state: 'healthy' | 'degraded';
        lastRun: SchedulerLastRunStatus;
      }>
    >
  >;
}

export const collectEngagementHealth = async (
  input: Readonly<{
    enabled: boolean;
    repository?: Readonly<{
      healthCheck(): Promise<boolean>;
      statusCounts(): Promise<EngagementRecordCounts>;
      engagementPaused(): Promise<boolean>;
    }>;
    schedulers?: Readonly<
      Record<string, EngagementSchedulerHealth | undefined>
    >;
  }>,
): Promise<EngagementHealth> => {
  if (!input.repository)
    return {
      enabled: input.enabled,
      paused: true,
      database: 'unavailable',
      recordCounts: 'unavailable',
      schedulers: schedulerHealth(input.schedulers),
    };

  const [database, counts, paused] = await Promise.all([
    input.repository.healthCheck().catch(() => false),
    input.repository.statusCounts().catch(() => undefined),
    input.repository.engagementPaused().catch(() => true),
  ]);
  return {
    enabled: input.enabled,
    paused,
    database: database ? 'healthy' : 'degraded',
    recordCounts: counts ?? 'unavailable',
    schedulers: schedulerHealth(input.schedulers),
  };
};

const schedulerHealth = (
  schedulers:
    Readonly<Record<string, EngagementSchedulerHealth | undefined>> | undefined,
): EngagementHealth['schedulers'] =>
  Object.fromEntries(
    Object.entries(schedulers ?? {}).flatMap(([name, scheduler]) =>
      scheduler === undefined
        ? []
        : [
            [
              name,
              {
                state: scheduler.healthy ? 'healthy' : 'degraded',
                lastRun: scheduler.lastRun?.status ?? 'never',
              },
            ],
          ],
    ),
  );
