import type {
  EngagementCardDeletion,
  EngagementRepository,
} from './storage.js';

type DeletionRepository = EngagementRepository &
  Required<
    Pick<
      EngagementRepository,
      | 'listPendingCardDeletions'
      | 'listPendingCardDeletionsForOwner'
      | 'completeCardDeletion'
    >
  >;

export class EngagementDeletionService {
  constructor(
    private readonly dependencies: Readonly<{
      repository: DeletionRepository;
      gateway: {
        delete(channelId: string, messageId: string): Promise<void>;
      };
    }>,
  ) {}

  async deleteOwnerData(
    guildId: string,
    userId: string,
  ): Promise<EngagementDeletionOutcome> {
    const normalizedGuildId = guildId.trim();
    const normalizedUserId = userId.trim();
    const before = await this.pendingForOwner(
      normalizedGuildId,
      normalizedUserId,
      100,
    );
    const affected = await this.dependencies.repository.deleteOwnerData(
      normalizedGuildId,
      normalizedUserId,
    );
    const staged = await this.pendingForOwner(
      normalizedGuildId,
      normalizedUserId,
      100,
    );
    const newlyQueued = Math.max(0, staged.length - before.length);
    const completed =
      Math.max(0, affected - newlyQueued) + (await this.cleanup(staged));
    const pending = (
      await this.pendingForOwner(normalizedGuildId, normalizedUserId, 100)
    ).length;
    return { completed, pending };
  }

  async cleanupPending(limit = 100): Promise<number> {
    return this.cleanup(
      await this.dependencies.repository.listPendingCardDeletions(limit),
    );
  }

  private async cleanup(
    deletions: readonly EngagementCardDeletion[],
  ): Promise<number> {
    let completed = 0;
    for (const deletion of deletions) {
      try {
        await this.dependencies.gateway.delete(
          deletion.channelId,
          deletion.messageId,
        );
        if (await this.dependencies.repository.completeCardDeletion(deletion))
          completed += 1;
      } catch {
        // The durable deletion row remains pending for the next bounded retry.
      }
    }
    return completed;
  }

  private async pendingForOwner(
    guildId: string,
    userId: string,
    limit: number,
  ): Promise<readonly EngagementCardDeletion[]> {
    return this.dependencies.repository.listPendingCardDeletionsForOwner(
      guildId,
      userId,
      limit,
    );
  }
}

export interface EngagementDeletionOutcome {
  readonly completed: number;
  readonly pending: number;
}

export const isUnknownDiscordMessage = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: number | string }).code === 10008;

export type { EngagementCardDeletion };
