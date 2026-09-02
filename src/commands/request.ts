import {
  allowedMentions,
  replySafely,
  type DeferredReplyTarget,
  type ReplyPayload,
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
export const DISCORD_REQUEST_CONTENT_MAX = 2_000;

const wrongChannelMessage =
  'The /request command is only available in captains-quarters.';
const administratorMessage =
  'Request posting is restricted to configured MuthaShip administrators.';
const issueUnavailableMessage =
  'The GitHub issue could not be created. The request was not posted.';
const requestPostedMessage = 'Request posted.';
const requestPostedWithoutChannelMessage =
  'The GitHub issue was created but the public REQUEST could not be posted.';

export interface RequestCommandInteraction
  extends ReplyTarget, DeferredReplyTarget {
  readonly guildId: string | null;
  readonly channelId: string;
  readonly member?: Readonly<{
    roles?: Readonly<{ cache?: Readonly<{ has(id: string): boolean }> }>;
  }> | null;
  readonly options: Readonly<{
    getString(name: string): string | null;
  }>;
  readonly channel?: unknown;
  deferReply(payload: ReplyPayload): Promise<unknown>;
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
): string => {
  const issueLine = `issue: ${neutralizeDiscordMentions(issueUrl).trim()}`;
  const body = [
    'REQUEST',
    `what: ${neutralizeDiscordMentions(what).trim()}`,
    `why: ${neutralizeDiscordMentions(why).trim()}`,
    `done: ${neutralizeDiscordMentions(done).trim()}`,
  ].join('\n');
  const suffix = `\n${issueLine}`;
  const maximumBodyLength = DISCORD_REQUEST_CONTENT_MAX - suffix.length;
  if (maximumBodyLength < 1) {
    return takeWithinLimit(issueLine, DISCORD_REQUEST_CONTENT_MAX);
  }
  if (body.length <= maximumBodyLength) {
    return `${body}${suffix}`;
  }
  const truncated = takeWithinLimit(body, Math.max(0, maximumBodyLength - 1));
  return `${truncated}…${suffix}`;
};

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

  await interaction.deferReply({ ephemeral: true, allowedMentions });

  let created: GitHubIssueCreateResult;
  try {
    created = await dependencies.issues.createIssue(draft);
  } catch {
    await interaction.editReply({
      content: issueUnavailableMessage,
      allowedMentions,
    });
    return;
  }
  if (created.url.trim() === '') {
    await interaction.editReply({
      content: issueUnavailableMessage,
      allowedMentions,
    });
    return;
  }

  const content = formatRequestMessage(what, why, done, created.url);
  const issueLine = `issue: ${neutralizeDiscordMentions(created.url).trim()}`;
  try {
    await postPublicRequest(interaction, content);
  } catch {
    await interaction.editReply({
      content: `${requestPostedWithoutChannelMessage}\n${issueLine}`,
      allowedMentions,
    });
    return;
  }
  await interaction.editReply({
    content: `${requestPostedMessage}\n${issueLine}`,
    allowedMentions,
  });
}

const postPublicRequest = async (
  interaction: RequestCommandInteraction,
  content: string,
): Promise<void> => {
  const send = channelSend(interaction.channel);
  if (send !== undefined) {
    await send({
      content,
      allowedMentions,
    });
    return;
  }
  await interaction.followUp({
    content,
    ephemeral: false,
    allowedMentions,
  });
};

const channelSend = (
  channel: unknown,
): ((payload: ReplyPayload) => Promise<unknown>) | undefined => {
  if (typeof channel !== 'object' || channel === null || !('send' in channel)) {
    return undefined;
  }
  const send = channel.send;
  if (typeof send !== 'function') {
    return undefined;
  }
  return (payload) => Promise.resolve(send.call(channel, payload));
};

const takeWithinLimit = (content: string, limit: number): string => {
  let length = 0;
  let end = 0;
  for (const character of content) {
    if (length + character.length > limit) {
      break;
    }
    length += character.length;
    end += character.length;
  }
  return content.slice(0, end);
};
