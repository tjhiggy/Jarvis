/**
 * The bot's authorization contract. This is intentionally descriptive and
 * read-only: Discord role permissions remain the server owner's control.
 */
export type CommandPermissionScope =
  'member' | 'configured-admin' | 'poll-admin-user';

export interface CommandPermissionRule {
  readonly command: string;
  readonly scope: CommandPermissionScope;
  readonly notes: string;
}

export const commandPermissionRules: readonly CommandPermissionRule[] = [
  {
    command:
      '/ask, /search, /faq, /knowledge query, /catch-me-up, /channel-summary',
    scope: 'member',
    notes: 'Allowed channel and input checks still apply.',
  },
  {
    command:
      '/forget, /reminder, /birthday, /lfg, /roles, /introduce, /suggest, /event list, /event details',
    scope: 'member',
    notes: 'User-owned data or explicitly allowlisted engagement choices only.',
  },
  {
    command: '/knowledge list, /knowledge approve, /knowledge revoke',
    scope: 'configured-admin',
    notes: 'Requires an ID in ENGAGEMENT_ADMIN_ROLE_IDS.',
  },
  {
    command:
      '/engagement, /config, /game-night, /event create, /event cancel, /post, /request',
    scope: 'configured-admin',
    notes:
      'Requires the configured administrator role allowlist and feature-specific gates. /request also opens one GitHub issue in the configured repository.',
  },
  {
    command: '/poll, /poll-close',
    scope: 'poll-admin-user',
    notes: 'Requires the invoking user ID in POLL_ADMIN_USER_IDS.',
  },
  {
    command: '/status, /help',
    scope: 'member',
    notes: 'Secrets are omitted from all output.',
  },
];

export const formatCommandPermissionRules = (): string =>
  commandPermissionRules
    .map((rule) => `- ${rule.command}: ${rule.scope} (${rule.notes})`)
    .join('\n');
