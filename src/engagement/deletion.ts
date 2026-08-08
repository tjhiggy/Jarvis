import type {
  EngagementCardDeletion,
  EngagementRepository,
} from './storage.js';

type DeletionRepository = EngagementRepository &
  Required<
    Pick<
      EngagementRepository,
      'listPendingCardDeletions' | 'completeCardDeletion'
    >
  >;

export class EngagementDeletionService {
  constructor(
    private readonly dependencies: Readonly<{
      repository: DeletionRepository;
      gateway: {
        delete(channelId: string, messageId: string): Promise<void>;
      };
      now?: () => Date;
    }>,
  ) {}

  async deleteOwnerData(guildId: string, userId: string): Promise<number> {
    const affected = await this.dependencies.repository.deleteOwnerData(
      guildId.trim(),
      userId.trim(),
    );
    await this.cleanupPending(100);
    return affected;
  }

  async cleanupPending(limit = 100): Promise<number> {
    let completed = 0;
    for (const deletion of await this.dependencies.repository.listPendingCardDeletions(
      limit,
    )) {
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
}

export const isUnknownDiscordMessage = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: number | string }).code === 10008;

export type { EngagementCardDeletion };
