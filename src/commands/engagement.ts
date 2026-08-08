import { replySafely, type ReplyTarget } from '../discord/delivery.js';
import { collectEngagementHealth, type EngagementSchedulerHealth } from '../engagement/health.js';

type OperationalRepository = Readonly<{
  engagementPaused(guildId: string): Promise<boolean>;
  setEngagementPaused(
    guildId: string,
    paused: boolean,
    actorUserId: string,
    updatedAt: Date,
  ): Promise<void>;
  healthCheck(): Promise<boolean>;
  statusCounts(guildId: string): Promise<{
    introductions: number;
    suggestions: number;
    events: number;
    rsvps: number;
    triviaRounds: number;
  }>;
}>;

export const handleEngagementCommand = async (
  interaction: ReplyTarget & {
    guildId: string | null;
    user: Readonly<{ id: string }>;
    member?: { roles?: { cache?: { has(id: string): boolean } } } | null;
    options: { getSubcommand(): string };
  },
  dependencies: Readonly<{
    enabled: boolean;
    adminRoleIds: ReadonlySet<string>;
    repository?: OperationalRepository;
    schedulers?: Readonly<Record<string, EngagementSchedulerHealth | undefined>>;
    now?: () => Date;
  }>,
): Promise<void> => {
  if (!interaction.guildId?.trim())
    return replySafely(
      interaction,
      'This command is available only in a server channel.',
      true,
    );
  if (!dependencies.enabled || !dependencies.repository)
    return replySafely(
      interaction,
      'Engagement controls are not configured on the MuthaShip.',
      true,
    );
  const authorized = [...dependencies.adminRoleIds].some((role) =>
    interaction.member?.roles?.cache?.has(role),
  );
  if (!authorized)
    return replySafely(
      interaction,
      'Engagement controls are restricted to configured MuthaShip administrators.',
      true,
    );

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'pause' || subcommand === 'resume') {
    const paused = subcommand === 'pause';
    await dependencies.repository.setEngagementPaused(
      interaction.guildId,
      paused,
      interaction.user.id,
      (dependencies.now ?? (() => new Date()))(),
    );
    return replySafely(
      interaction,
      paused
        ? 'Engagement scheduling is paused for this guild.'
        : 'Engagement scheduling is resumed for this guild.',
      true,
    );
  }

  const health = await collectEngagementHealth({
    enabled: dependencies.enabled,
    repository: {
      healthCheck: dependencies.repository.healthCheck,
      statusCounts: () => dependencies.repository!.statusCounts(interaction.guildId!),
      engagementPaused: () => dependencies.repository!.engagementPaused(interaction.guildId!),
    },
    ...(dependencies.schedulers === undefined
      ? {}
      : { schedulers: dependencies.schedulers }),
  });
  const counts =
    health.recordCounts === 'unavailable'
      ? 'Record counts: unavailable'
      : `Records: introductions ${health.recordCounts.introductions}, suggestions ${health.recordCounts.suggestions}, events ${health.recordCounts.events}, RSVPs ${health.recordCounts.rsvps}, trivia rounds ${health.recordCounts.triviaRounds}`;
  const schedulers = Object.entries(health.schedulers)
    .map(([name, scheduler]) => `${name}: ${scheduler.state}, last run ${scheduler.lastRun}`)
    .join('\n');
  return replySafely(
    interaction,
    [
      `Engagement: ${health.enabled ? 'enabled' : 'disabled'}${health.paused ? ' (paused)' : ''}`,
      `Engagement database: ${health.database}`,
      counts,
      schedulers === '' ? 'Schedulers: unavailable' : `Schedulers: ${schedulers}`,
    ].join('\n'),
    true,
  );
};
