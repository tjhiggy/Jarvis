export type PollStatus =
  'creating' | 'active' | 'closed' | 'orphaned' | 'failed';

export type PollSyncState = 'pending' | 'synced' | 'orphaned';

export interface PollOptionView {
  readonly index: number;
  readonly label: string;
  readonly voteCount: number;
}

export interface PollView {
  readonly id: string;
  readonly guildId: string;
  readonly conversationId: string;
  readonly channelId: string;
  readonly parentChannelId?: string;
  readonly messageId?: string;
  readonly creatorUserId: string;
  readonly question: string;
  readonly status: PollStatus;
  readonly closesAt: Date;
  readonly closedAt?: Date;
  readonly syncState: PollSyncState;
  readonly options: readonly PollOptionView[];
}
