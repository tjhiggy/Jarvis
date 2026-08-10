import { isAllowedRssUrl } from '../notifications/rss-notifications.js';
import type { RssStorage } from '../notifications/rss-storage.js';

export interface RssCommandInteraction {
  readonly guildId: string | null;
  readonly member?: Readonly<{
    roles?: Readonly<{ cache?: Readonly<{ has(id: string): boolean }> }>;
  }> | null;
  readonly options: Readonly<{
    getSubcommand(): string;
    getString(name: string): string | null;
  }>;
  reply(
    payload: Readonly<{
      content: string;
      ephemeral: true;
      allowedMentions: Readonly<{
        parse: readonly string[];
        repliedUser: false;
      }>;
    }>,
  ): Promise<unknown>;
}

export interface RssCommandDependencies {
  readonly storage: Pick<
    RssStorage,
    'addFeed' | 'listFeeds' | 'removeFeed' | 'setPaused'
  >;
  readonly adminRoleIds: ReadonlySet<string>;
  readonly allowedHosts: readonly string[];
}

const respond = (interaction: RssCommandInteraction, content: string) =>
  interaction.reply({
    content,
    ephemeral: true,
    allowedMentions: { parse: [], repliedUser: false },
  });

export async function handleRssCommand(
  interaction: RssCommandInteraction,
  deps: RssCommandDependencies,
): Promise<void> {
  const serverId = interaction.guildId?.trim();
  if (!serverId) {
    await respond(
      interaction,
      'RSS controls are only available aboard the MuthaShip.',
    );
    return;
  }
  const admin = [...deps.adminRoleIds].some((roleId) =>
    interaction.member?.roles?.cache?.has(roleId),
  );
  if (!admin) {
    await respond(
      interaction,
      'Only an authorized MuthaShip administrator can manage RSS feeds.',
    );
    return;
  }
  const action = interaction.options.getSubcommand();
  if (action === 'list') {
    const feeds = deps.storage.listFeeds(serverId);
    await respond(
      interaction,
      feeds.length === 0
        ? 'No RSS feeds are configured.'
        : feeds
            .map(
              (feed) =>
                `• ${feed.label}: ${feed.url}${feed.paused ? ' (paused)' : ''}`,
            )
            .join('\n'),
    );
    return;
  }
  if (action === 'pause' || action === 'resume') {
    deps.storage.setPaused(serverId, action === 'pause');
    await respond(
      interaction,
      `RSS monitoring ${action === 'pause' ? 'paused' : 'resumed'} for this MuthaShip.`,
    );
    return;
  }
  const url = interaction.options.getString('url')?.trim() ?? '';
  if (!isAllowedRssUrl(url, deps.allowedHosts)) {
    await respond(
      interaction,
      'That HTTPS feed host is not on the approved RSS allowlist.',
    );
    return;
  }
  if (action === 'remove') {
    await respond(
      interaction,
      deps.storage.removeFeed(serverId, url)
        ? 'RSS feed removed.'
        : 'That RSS feed was not configured.',
    );
    return;
  }
  if (action === 'add') {
    const label = interaction.options.getString('label')?.trim() ?? '';
    if (!label || label.length > 80) {
      await respond(
        interaction,
        'Provide a feed label between 1 and 80 characters.',
      );
      return;
    }
    deps.storage.addFeed(serverId, url, label);
    await respond(
      interaction,
      'RSS feed added. Jarvis will monitor it after scheduling is enabled.',
    );
    return;
  }
  await respond(interaction, 'Unknown RSS action.');
}
