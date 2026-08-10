import { replySafely, type ReplyTarget } from '../discord/delivery.js';
import {
  collectEngagementHealth,
  type EngagementSchedulerHealth,
} from '../engagement/health.js';
import type { EngagementDeletionOutcome } from '../engagement/deletion.js';
import type { MetricsSummaryRow } from '../platform/metrics.js';

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
  deleteOwnerData(
    guildId: string,
    userId: string,
  ): Promise<EngagementDeletionOutcome>;
  analyticsSummary?(guildId: string, since: Date): Promise<readonly MetricsSummaryRow[]>;
  analyticsSummary?(guildId: string, since: Date): Promise<readonly MetricsSummaryRow[]>;
}>;

export const handleEngagementCommand = async (
  interaction: ReplyTarget & {
    guildId: string | null;
    user: Readonly<{ id: string }>;
    member?: { roles?: { cache?: { has(id: string): boolean } } } | null;
    options: {
      getSubcommand(): string;
      getString?(name: string): string | null;
    };
  },
  dependencies: Readonly<{
    enabled: boolean;
    adminRoleIds: ReadonlySet<string>;
    repository?: OperationalRepository;
    schedulers?: Readonly<
      Record<string, EngagementSchedulerHealth | undefined>
    >;
    features?: readonly string[];
    platform?: Readonly<{
      version: string;
      deployment: string;
      provider: string;
      openaiConfigured: boolean;
      ollamaConfigured: boolean;
      webSearchConfigured: boolean;
      integrations: readonly string[];
    }>;
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
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'delete') {
    const target =
      interaction.options.getString?.('user_id')?.trim() || interaction.user.id;
    if (target !== interaction.user.id && !authorized)
      return replySafely(
        interaction,
        "Deleting another member's engagement records is restricted to configured MuthaShip administrators.",
        true,
      );
    const deletion = await dependencies.repository.deleteOwnerData(
      interaction.guildId,
      target,
    );
    const content =
      deletion.completed === 0 && deletion.pending === 0
        ? 'No retained engagement records were found for that member on this MuthaShip.'
        : deletion.pending === 0
          ? `Removed ${deletion.completed} retained engagement records from this MuthaShip.`
          : `Removed ${deletion.completed} retained engagement records; ${deletion.pending} card-backed records remain queued for deletion retry.`;
    return replySafely(interaction, content, true);
  }
  if (!authorized)
    return replySafely(
      interaction,
      'Engagement controls are restricted to configured MuthaShip administrators.',
      true,
    );

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
        ? 'Engagement scheduling is paused for this MuthaShip.'
        : 'Engagement scheduling is resumed for this MuthaShip.',
      true,
    );
  }

  if (subcommand === 'metrics') {
    if (dependencies.repository.analyticsSummary === undefined)
      return replySafely(interaction, 'Aggregate metrics are not available on this MuthaShip.', true);
    const since = new Date((dependencies.now ?? (() => new Date()))().getTime() - 7 * 24 * 60 * 60 * 1000);
    const rows = await dependencies.repository.analyticsSummary(interaction.guildId, since);
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    const failures = rows.filter((row) => row.eventName === 'command_failed').reduce((sum, row) => sum + row.count, 0);
    const top = [...rows].sort((a, b) => b.count - a.count).slice(0, 10);
    const breakdown = top.length === 0
      ? 'No command activity recorded in the last 7 days.'
      : top.map((row) => `${row.command || row.feature}: ${row.eventName} ${row.count}`).join('\n');
    return replySafely(interaction, [`Metrics, last 7 days: ${total} events, ${failures} command failures.`, breakdown].join('\n'), true);
  }

  const health = await collectEngagementHealth({
    enabled: dependencies.enabled,
    repository: {
      healthCheck: dependencies.repository.healthCheck,
      statusCounts: () =>
        dependencies.repository!.statusCounts(interaction.guildId!),
      engagementPaused: () =>
        dependencies.repository!.engagementPaused(interaction.guildId!),
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
    .map(
      ([name, scheduler]) =>
        `${name}: ${scheduler.state}, last run ${scheduler.lastRun}`,
    )
    .join('\n');
  const features = dependencies.features?.join(', ') ?? 'none';
  const metrics = dependencies.repository.analyticsSummary === undefined
    ? 'Metrics: unavailable'
    : (() => {
        const since = new Date((dependencies.now ?? (() => new Date()))().getTime() - 7 * 24 * 60 * 60 * 1000);
        return dependencies.repository.analyticsSummary(interaction.guildId!, since).then((rows) => {
          const total = rows.reduce((sum, row) => sum + row.count, 0);
          const failures = rows.filter((row) => row.eventName === 'command_failed').reduce((sum, row) => sum + row.count, 0);
          return `Metrics, last 7 days: ${total} events, ${failures} command failures.`;
        });
      })();
  const metricsLine = typeof metrics === 'string' ? metrics : await metrics;
  return replySafely(
    interaction,
    [
      `Engagement: ${health.enabled ? 'enabled' : 'disabled'}${health.paused ? ' (paused)' : ''}`,
      `Engagement database: ${health.database}`,
      `Enabled features: ${features || 'none'}`,
      counts,
      metricsLine,
      ...(dependencies.platform === undefined
        ? []
        : [
            `Platform: Jarvis ${dependencies.platform.version} (${dependencies.platform.deployment})`,
            `Providers: ${dependencies.platform.provider}; OpenAI ${dependencies.platform.openaiConfigured ? 'configured' : 'not configured'}; Ollama ${dependencies.platform.ollamaConfigured ? 'configured' : 'not configured'}; web search ${dependencies.platform.webSearchConfigured ? 'configured' : 'not configured'}`,
            `Integrations: ${dependencies.platform.integrations.join(', ') || 'none'}`,
          ]),
      schedulers === ''
        ? 'Schedulers: unavailable'
        : `Schedulers: ${schedulers}`,
    ].join('\n'),
    true,
  );
};
