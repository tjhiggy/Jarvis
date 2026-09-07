import {
  allowedMentions,
  replySafely,
  type ReplyTarget,
} from '../discord/delivery.js';
import {
  GITHUB_ISSUE_TITLE_MAX,
  type GitHubIssueCreateResult,
  type GitHubIssueCreateService,
  type GitHubIssueDraft,
} from '../github/issue-create.js';
import { neutralizeDiscordMentions } from '../utils/mentions.js';

export const CAPTAINS_QUARTERS_CHANNEL_ID = '953011731356086283';

const wrongChannelMessage =
  'The /request command is only available in captains-quarters.';
const administratorMessage =
  'Request posting is restricted to configured MuthaShip administrators.';
const issueUnavailableMessage =
  'The GitHub issue could not be created. The request was not posted.';

export interface RequestCommandInteraction extends ReplyTarget {
  readonly guildId: string | null;
  readonly channelId: string;
  readonly member?: Readonly<{
    roles?: Readonly<{ cache?: Readonly<{ has(id: string): boolean }> }>;
  }> | null;
  readonly options: Readonly<{
    getString(name: string): string | null;
  }>;
}

export const formatRequestIssue = (
  what: string,
  why: string,
  done: string,
): GitHubIssueDraft => {
  const safeWhat = neutralizeDiscordMentions(what).trim();
  const safeWhy = neutralizeDiscordMentions(why).trim();
  const safeDone = neutralizeDiscordMentions(done).trim();
  return {
    title: safeWhat.slice(0, GITHUB_ISSUE_TITLE_MAX),
    body: [
      '## What',
      safeWhat,
      '',
      '## Why',
      safeWhy,
      '',
      '## Done',
      safeDone,
    ].join('\n'),
  };
};

export const formatRequestMessage = (
  what: string,
  why: string,
  done: string,
  issueUrl: string,
): string =>
  [
    'REQUEST',
    `what: ${neutralizeDiscordMentions(what).trim()}`,
    `why: ${neutralizeDiscordMentions(why).trim()}`,
    `done: ${neutralizeDiscordMentions(done).trim()}`,
    `issue: ${neutralizeDiscordMentions(issueUrl).trim()}`,
  ].join('\n');

const isAdministrator = (
  interaction: RequestCommandInteraction,
  adminRoleIds: ReadonlySet<string>,
): boolean =>
  [...adminRoleIds].some((roleId) =>
    interaction.member?.roles?.cache?.has(roleId),
  );

export async function handleRequestCommand(
  interaction: RequestCommandInteraction,
  dependencies: Readonly<{
    adminRoleIds: ReadonlySet<string>;
    channelId?: string;
    issues?: Pick<GitHubIssueCreateService, 'createIssue'>;
  }>,
): Promise<void> {
  if (!interaction.guildId?.trim()) {
    await replySafely(
      interaction,
      'This command is available only in a server channel.',
      true,
    );
    return;
  }
  const channelId = (
    dependencies.channelId ?? CAPTAINS_QUARTERS_CHANNEL_ID
  ).trim();
  if (interaction.channelId.trim() !== channelId) {
    await replySafely(interaction, wrongChannelMessage, true);
    return;
  }
  if (!isAdministrator(interaction, dependencies.adminRoleIds)) {
    await replySafely(interaction, administratorMessage, true);
    return;
  }
  const what = interaction.options.getString('what')?.trim() ?? '';
  const why = interaction.options.getString('why')?.trim() ?? '';
  const done = interaction.options.getString('done')?.trim() ?? '';
  if (what === '' || why === '' || done === '') {
    await replySafely(
      interaction,
      'Provide what, why, and done for this request.',
      true,
    );
    return;
  }
  const draft = formatRequestIssue(what, why, done);
  if (draft.title === '' || dependencies.issues === undefined) {
    await replySafely(interaction, issueUnavailableMessage, true);
    return;
  }
  let created: GitHubIssueCreateResult;
  try {
    created = await dependencies.issues.createIssue(draft);
  } catch {
    await replySafely(interaction, issueUnavailableMessage, true);
    return;
  }
  if (created.url.trim() === '') {
    await replySafely(interaction, issueUnavailableMessage, true);
    return;
  }
  await interaction.reply({
    content: formatRequestMessage(what, why, done, created.url),
    ephemeral: false,
    allowedMentions,
  });
}
