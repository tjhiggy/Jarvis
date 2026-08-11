import type { BroadcastPolicyService } from '../notifications/broadcast-policy.js';
import type { BroadcastStore } from '../notifications/broadcast-store.js';
import {
  selectEligiblePrompts,
  type ProactivePrompt,
} from '../notifications/proactive-catalog.js';
import { neutralizeDiscordMentions } from '../utils/mentions.js';

export type ProactiveState = 'disabled' | 'enabled' | 'paused';

export interface ProactiveGateway {
  post(channelId: string, content: string): Promise<void>;
}

export interface ProactiveStore {
  get(
    guildId: string,
  ): Promise<{ state: ProactiveState; lastPostedAt?: Date } | undefined>;
  set(guildId: string, state: ProactiveState, updatedAt: Date): Promise<void>;
  recordPosted?(guildId: string, postedAt: Date): Promise<void>;
}

type ProactiveDeliveryStore = Pick<
  BroadcastStore,
  'claimDelivery' | 'completeDelivery' | 'releaseDelivery'
>;

type ProactiveLogger = Readonly<{
  warn(context: Record<string, unknown>, message: string): void;
}>;

export const buildProactivePreview = (content: string): string =>
  neutralizeDiscordMentions(content).slice(0, 1_000);

export class ProactiveEngagementService {
  constructor(
    private readonly dependencies: Readonly<{
      store: ProactiveStore;
      broadcastStore: ProactiveDeliveryStore;
      policy: Pick<BroadcastPolicyService, 'evaluate'>;
      gateway: ProactiveGateway;
      catalog: readonly ProactivePrompt[];
      channelId: string;
      guildId: string;
      now?: () => Date;
      quietHours?: readonly [number, number];
      minIntervalMs?: number;
      logger?: ProactiveLogger;
    }>,
  ) {}

  async status(): Promise<{ state: ProactiveState; lastPostedAt?: Date }> {
    return (
      (await this.dependencies.store.get(this.dependencies.guildId)) ?? {
        state: 'disabled',
      }
    );
  }

  async setState(
    state: Exclude<ProactiveState, 'disabled'> | 'disabled',
  ): Promise<void> {
    await this.dependencies.store.set(
      this.dependencies.guildId,
      state,
      this.clock(),
    );
  }

  async preview(): Promise<string> {
    const prompt = selectEligiblePrompts(
      this.dependencies.catalog,
      this.clock(),
    )[0];
    return prompt === undefined
      ? 'No approved proactive crew prompts are active.'
      : buildProactivePreview(prompt.text);
  }

  async tick(): Promise<boolean> {
    const current = await this.status();
    if (current.state !== 'enabled' || this.dependencies.channelId === '') {
      return false;
    }

    const now = this.clock();
    if (
      this.inQuietHours(now) ||
      (current.lastPostedAt !== undefined &&
        now.getTime() - current.lastPostedAt.getTime() <
          (this.dependencies.minIntervalMs ?? 6 * 60 * 60_000))
    ) {
      return false;
    }

    const prompt = selectEligiblePrompts(this.dependencies.catalog, now)[0];
    if (prompt === undefined) return false;
    if (!(await this.allowsDelivery(now))) return false;

    const deliveryKey = `${prompt.id}:${now.toISOString().slice(0, 13)}`;
    const leaseToken = await this.dependencies.broadcastStore.claimDelivery(
      this.dependencies.guildId,
      'proactive',
      deliveryKey,
      now,
    );
    if (leaseToken === undefined) return false;

    if (!(await this.allowsDelivery(this.clock()))) {
      await this.dependencies.broadcastStore.releaseDelivery(
        this.dependencies.guildId,
        'proactive',
        deliveryKey,
        leaseToken,
        this.clock(),
      );
      return false;
    }

    try {
      await this.dependencies.gateway.post(
        this.dependencies.channelId,
        buildProactivePreview(prompt.text),
      );
      const completed = await this.dependencies.broadcastStore.completeDelivery(
        this.dependencies.guildId,
        'proactive',
        deliveryKey,
        leaseToken,
        this.clock(),
      );
      if (!completed) return false;
      if (this.dependencies.store.recordPosted !== undefined) {
        await this.dependencies.store.recordPosted(
          this.dependencies.guildId,
          now,
        );
      } else {
        await this.dependencies.store.set(
          this.dependencies.guildId,
          'enabled',
          now,
        );
      }
      return true;
    } catch (error) {
      const errorCategory = deliveryErrorCategory(error);
      await this.dependencies.broadcastStore.releaseDelivery(
        this.dependencies.guildId,
        'proactive',
        deliveryKey,
        leaseToken,
        this.clock(),
        errorCategory,
      );
      this.dependencies.logger?.warn(
        { errorCategory, operation: 'proactive_delivery' },
        'Approved proactive delivery failed.',
      );
      return false;
    }
  }

  private async allowsDelivery(now: Date): Promise<boolean> {
    return (
      await this.dependencies.policy.evaluate({
        serverId: this.dependencies.guildId,
        category: 'proactive',
        channelId: this.dependencies.channelId,
        now,
      })
    ).allowed;
  }

  private clock(): Date {
    return (this.dependencies.now ?? (() => new Date()))();
  }

  private inQuietHours(now: Date): boolean {
    const [start, end] = this.dependencies.quietHours ?? [23, 8];
    const hour = now.getHours();
    return start > end
      ? hour >= start || hour < end
      : hour >= start && hour < end;
  }
}

const deliveryErrorCategory = (
  error: unknown,
): 'network' | 'permission' | 'rate_limit' | 'service' => {
  const code =
    error instanceof Error
      ? (error as Error & { readonly code?: unknown }).code
      : undefined;
  if (code === 429 || code === 'RATE_LIMITED') return 'rate_limit';
  if (code === 50001 || code === 50013 || code === 'MISSING_PERMISSIONS') {
    return 'permission';
  }
  return 'network';
};

export interface ProactiveScheduler {
  start(): void;
  stop(): Promise<void>;
}

export class DurableProactiveScheduler implements ProactiveScheduler {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly service: ProactiveEngagementService,
    private readonly intervalMs = 60_000,
  ) {}

  start(): void {
    if (!this.timer) {
      this.timer = setInterval(() => void this.service.tick(), this.intervalMs);
    }
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
