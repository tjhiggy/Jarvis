import { isAllowedChannel } from '../discord/access.js';
import type { ReminderFailureCategory } from './reminder-store.js';
import {
  renderReminderMessage,
  type ReminderMessagePayload,
} from './reminder-renderer.js';
import type { ReminderView } from './reminder-types.js';

export type { ReminderMessagePayload };

export interface ReminderDeliveryChannel {
  readonly id: string;
  readonly guildId: string;
  readonly parentId?: string;
  send(payload: ReminderMessagePayload): Promise<unknown>;
}

export type ReminderDeliveryOutcome =
  | Readonly<{ kind: 'delivered' }>
  | Readonly<{
      kind: 'transient-failure';
      category: 'rate-limit' | 'network' | 'service';
    }>
  | Readonly<{
      kind: 'permanent-failure';
      category: 'unknown-channel' | 'permission';
    }>
  | Readonly<{ kind: 'uncertain' }>;

export interface ReminderDeliveryGateway {
  deliver(reminder: ReminderView, now: Date): Promise<ReminderDeliveryOutcome>;
}

export interface DiscordReminderDeliveryGatewayDependencies {
  readonly allowedChannelIds: ReadonlySet<string>;
  readonly fetchChannel: (
    channelId: string,
  ) => Promise<ReminderDeliveryChannel | undefined>;
}

export class DiscordReminderDeliveryGateway implements ReminderDeliveryGateway {
  private readonly allowedChannelIds: ReadonlySet<string>;
  private readonly fetchChannel: DiscordReminderDeliveryGatewayDependencies['fetchChannel'];

  constructor(dependencies: DiscordReminderDeliveryGatewayDependencies) {
    this.allowedChannelIds = dependencies.allowedChannelIds;
    this.fetchChannel = dependencies.fetchChannel;
  }

  async deliver(
    reminder: ReminderView,
    now: Date,
  ): Promise<ReminderDeliveryOutcome> {
    let channel: ReminderDeliveryChannel | undefined;
    try {
      channel = await this.fetchChannel(reminder.channelId);
    } catch (error) {
      return failureOutcome(categorizeKnownFailure(error) ?? 'service');
    }

    if (channel === undefined) {
      return permanentFailure('unknown-channel');
    }
    if (
      channel.id !== reminder.channelId ||
      channel.guildId !== reminder.guildId ||
      channel.parentId !== reminder.parentChannelId ||
      !isAllowedChannel(channel.id, channel.parentId, this.allowedChannelIds)
    ) {
      return permanentFailure('permission');
    }

    try {
      await channel.send(renderReminderMessage(reminder, now));
      return { kind: 'delivered' };
    } catch (error) {
      const category = categorizeKnownFailure(error);
      return category === undefined
        ? { kind: 'uncertain' }
        : failureOutcome(category);
    }
  }
}

const failureOutcome = (
  category: ReminderFailureCategory,
): ReminderDeliveryOutcome =>
  category === 'unknown-channel' || category === 'permission'
    ? permanentFailure(category)
    : { kind: 'transient-failure', category };

const permanentFailure = (
  category: 'unknown-channel' | 'permission',
): ReminderDeliveryOutcome => ({ kind: 'permanent-failure', category });

const categorizeKnownFailure = (
  error: unknown,
): ReminderFailureCategory | undefined => {
  if (typeof error !== 'object' || error === null) return undefined;

  const candidate = error as Readonly<{
    code?: unknown;
    status?: unknown;
    httpStatus?: unknown;
    name?: unknown;
  }>;
  const status =
    numericValue(candidate.status) ?? numericValue(candidate.httpStatus);
  const code = numericValue(candidate.code);
  if (code === 10_003 || status === 404) return 'unknown-channel';
  if (code === 50_001 || code === 50_013 || status === 401 || status === 403) {
    return 'permission';
  }
  if (code === 429 || status === 429) return 'rate-limit';
  if (
    (typeof candidate.code === 'string' &&
      /^(?:E(?:AI_AGAIN|CONN|HOST|NET|PIPE|TIMEDOUT)|UND_ERR_)/.test(
        candidate.code,
      )) ||
    candidate.name === 'AbortError' ||
    candidate.name === 'FetchError'
  ) {
    return 'network';
  }
  if (
    (status !== undefined && status >= 500 && status <= 599) ||
    code !== undefined
  ) {
    return 'service';
  }
  return undefined;
};

const numericValue = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
