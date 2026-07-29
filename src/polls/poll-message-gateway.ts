import type { PollView } from './poll-types.js';
import {
  renderPollMessage,
  renderUnavailablePollMessage,
  type PollMessagePayload,
} from './poll-renderer.js';

export type { PollMessagePayload };

export interface PollMessageGateway {
  create(interaction: PollCreationTarget, poll: PollView): Promise<string>;
  update(poll: PollView): Promise<void>;
  markUnavailable(poll: PollView): Promise<void>;
}

export interface PollCreationTarget {
  editReply(options: PollMessagePayload): Promise<unknown>;
  fetchReply(): Promise<Readonly<{ id: string }>>;
}

export type PollGatewayErrorCategory =
  'unknown-message' | 'permission' | 'rate-limit' | 'network' | 'service';

export class PollMessageGatewayError extends Error {
  readonly category: PollGatewayErrorCategory;

  constructor(category: PollGatewayErrorCategory) {
    super(`Poll message operation failed: ${category}.`);
    this.name = 'PollMessageGatewayError';
    this.category = category;
  }
}

export interface PollMessageTarget {
  readonly author: Readonly<{ id: string }>;
  edit(options: PollMessagePayload): Promise<unknown>;
}

export interface PollChannelTarget {
  readonly messages: Readonly<{
    fetch(messageId: string): Promise<PollMessageTarget>;
  }>;
}

export interface DiscordPollMessageGatewayDependencies {
  readonly botUserId: string;
  readonly fetchChannel: (
    channelId: string,
  ) => Promise<PollChannelTarget | undefined>;
}

export class DiscordPollMessageGateway implements PollMessageGateway {
  private readonly botUserId: string;
  private readonly fetchChannel: DiscordPollMessageGatewayDependencies['fetchChannel'];

  constructor(dependencies: DiscordPollMessageGatewayDependencies) {
    this.botUserId = dependencies.botUserId.trim();
    this.fetchChannel = dependencies.fetchChannel;
  }

  async create(
    interaction: PollCreationTarget,
    poll: PollView,
  ): Promise<string> {
    try {
      await interaction.editReply(renderPollMessage(poll));
      const reply = await interaction.fetchReply();
      const messageId = reply.id.trim();
      if (messageId === '') {
        throw new PollMessageGatewayError('service');
      }
      return messageId;
    } catch (error) {
      throw toGatewayError(error);
    }
  }

  async update(poll: PollView): Promise<void> {
    await this.editOwnedMessage(poll, renderPollMessage(poll));
  }

  async markUnavailable(poll: PollView): Promise<void> {
    await this.editOwnedMessage(poll, renderUnavailablePollMessage(poll));
  }

  private async editOwnedMessage(
    poll: PollView,
    payload: PollMessagePayload,
  ): Promise<void> {
    const messageId = poll.messageId?.trim();
    if (messageId === undefined || messageId === '') {
      throw new PollMessageGatewayError('unknown-message');
    }
    if (this.botUserId === '') {
      throw new PollMessageGatewayError('service');
    }

    try {
      const channel = await this.fetchChannel(poll.channelId);
      if (channel === undefined) {
        throw new PollMessageGatewayError('unknown-message');
      }
      const message = await channel.messages.fetch(messageId);
      if (message.author.id !== this.botUserId) {
        throw new PollMessageGatewayError('permission');
      }
      await message.edit(payload);
    } catch (error) {
      throw toGatewayError(error);
    }
  }
}

const toGatewayError = (error: unknown): PollMessageGatewayError => {
  if (error instanceof PollMessageGatewayError) {
    return error;
  }
  return new PollMessageGatewayError(categorizeGatewayError(error));
};

const categorizeGatewayError = (error: unknown): PollGatewayErrorCategory => {
  if (typeof error !== 'object' || error === null) {
    return 'service';
  }

  const candidate = error as Readonly<{
    code?: unknown;
    status?: unknown;
    httpStatus?: unknown;
    name?: unknown;
  }>;
  const status =
    numericValue(candidate.status) ?? numericValue(candidate.httpStatus);
  const code = numericValue(candidate.code);
  if (code === 10_008 || code === 10_003 || status === 404) {
    return 'unknown-message';
  }
  if (code === 50_001 || code === 50_013 || status === 401 || status === 403) {
    return 'permission';
  }
  if (code === 429 || status === 429) {
    return 'rate-limit';
  }
  if (
    typeof candidate.code === 'string' &&
    /^(?:E(?:AI_AGAIN|CONN|HOST|NET|PIPE|TIMEDOUT)|UND_ERR_)/.test(
      candidate.code,
    )
  ) {
    return 'network';
  }
  if (candidate.name === 'AbortError' || candidate.name === 'FetchError') {
    return 'network';
  }
  return 'service';
};

const numericValue = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
