import type { AIService } from '../openai/openai-service.js';
import { neutralizeDiscordMentions } from '../utils/mentions.js';
import { projectOperationalError } from '../utils/logger.js';

export interface QuietNudgeChannelConfig {
  readonly channelId: string;
  readonly quietWindowMs: number;
}

export interface QuietNudgeState {
  readonly lastHumanAt?: Date;
  readonly lastNudgeAt?: Date;
}

export interface QuietNudgeStore {
  get(guildId: string, channelId: string): Promise<QuietNudgeState | undefined>;
  recordHumanMessage(
    guildId: string,
    channelId: string,
    at: Date,
  ): Promise<void>;
  recordNudge(guildId: string, channelId: string, at: Date): Promise<void>;
}

export interface QuietNudgeGateway {
  post(input: {
    channelId: string;
    content: string;
    allowedMentions: { parse: readonly []; repliedUser: false };
  }): Promise<void>;
  channelAvailable(channelId: string): Promise<boolean>;
}

export interface ChannelMessageSnapshot {
  readonly authorIsBot: boolean;
  readonly createdAt: Date;
}

export interface QuietNudgeHistory {
  latestHumanMessageAt(channelId: string): Promise<Date | undefined>;
}

export type QuietNudgeDecision =
  | { readonly action: 'skip'; readonly reason: string }
  | { readonly action: 'nudge' };

export const evaluateQuietNudge = (input: {
  readonly now: Date;
  readonly quietWindowMs: number;
  readonly state: QuietNudgeState;
  readonly latestHumanAt?: Date;
  readonly paused: boolean;
  readonly channelConfigured: boolean;
  readonly channelAvailable: boolean;
}): QuietNudgeDecision => {
  if (input.paused) return { action: 'skip', reason: 'paused' };
  if (!input.channelConfigured) return { action: 'skip', reason: 'unset_channel' };
  if (!input.channelAvailable) return { action: 'skip', reason: 'missing_channel' };

  const lastHumanAt = [
    input.state.lastHumanAt,
    input.latestHumanAt,
  ]
    .filter((value): value is Date => value !== undefined)
    .sort((left, right) => right.getTime() - left.getTime())[0];
  if (lastHumanAt === undefined) {
    return { action: 'skip', reason: 'no_human_baseline' };
  }

  const quietForMs = input.now.getTime() - lastHumanAt.getTime();
  if (quietForMs < input.quietWindowMs) {
    return { action: 'skip', reason: 'channel_active' };
  }

  const lastNudgeAt = input.state.lastNudgeAt;
  if (
    lastNudgeAt !== undefined &&
    lastNudgeAt.getTime() >= lastHumanAt.getTime()
  ) {
    return { action: 'skip', reason: 'already_nudged' };
  }

  return { action: 'nudge' };
};

const nudgeInstructions =
  'You are MuthaShip Jarvis, the advisory ship AI. Write one short sentence inviting crew talk in a quiet channel. Use sharp, confident, concise, slightly irreverent Jarvis voice. One MuthaShip phrase at most. No Discord mentions, no @everyone or @here, no personal questions, and no invented facts. Stay under 200 characters.';

const fallbackNudge =
  "This deck went quiet. If you're on the MuthaShip, speak up.";

const safeAllowedMentions = Object.freeze({
  parse: [] as const,
  repliedUser: false as const,
});

export class QuietChannelNudgeService {
  constructor(
    private readonly dependencies: Readonly<{
      store: QuietNudgeStore;
      gateway: QuietNudgeGateway;
      ai: AIService;
      guildId: string;
      channels: readonly QuietNudgeChannelConfig[];
      isGloballyPaused: (guildId: string) => Promise<boolean>;
      history?: QuietNudgeHistory;
      now?: () => Date;
      logger?: {
        warn(fields: Record<string, unknown>, message: string): void;
      };
    }>,
  ) {}

  get watchedChannelIds(): ReadonlySet<string> {
    return new Set(
      this.dependencies.channels
        .map((channel) => channel.channelId.trim())
        .filter(Boolean),
    );
  }

  async recordHumanMessage(channelId: string, at?: Date): Promise<void> {
    if (!this.watchedChannelIds.has(channelId)) return;
    await this.dependencies.store.recordHumanMessage(
      this.dependencies.guildId,
      channelId,
      at ?? this.clock(),
    );
  }

  async recordMessageSnapshot(
    channelId: string,
    snapshot: ChannelMessageSnapshot,
  ): Promise<void> {
    if (!this.watchedChannelIds.has(channelId) || snapshot.authorIsBot) return;
    await this.recordHumanMessage(channelId, snapshot.createdAt);
  }

  async tick(): Promise<boolean> {
    if (this.dependencies.channels.length === 0) return false;
    if (await this.dependencies.isGloballyPaused(this.dependencies.guildId)) {
      return false;
    }

    const now = this.clock();
    let posted = false;
    for (const channel of this.dependencies.channels) {
      if (channel.channelId.trim() === '' || channel.quietWindowMs < 1) continue;
      if (await this.tickChannel(channel, now)) posted = true;
    }
    return posted;
  }

  private async tickChannel(
    channel: QuietNudgeChannelConfig,
    now: Date,
  ): Promise<boolean> {
    const channelAvailable = await this.dependencies.gateway.channelAvailable(
      channel.channelId,
    );
    const state =
      (await this.dependencies.store.get(
        this.dependencies.guildId,
        channel.channelId,
      )) ?? {};
    const latestHumanAt =
      await this.dependencies.history?.latestHumanMessageAt(channel.channelId);
    const decision = evaluateQuietNudge({
      now,
      quietWindowMs: channel.quietWindowMs,
      state,
      ...(latestHumanAt === undefined ? {} : { latestHumanAt }),
      paused: false,
      channelConfigured: channel.channelId.trim() !== '',
      channelAvailable,
    });
    if (decision.action === 'skip') return false;

    const content = await this.composeNudge(now, channel.channelId);
    if (content.trim() === '') return false;

    try {
      await this.dependencies.gateway.post({
        channelId: channel.channelId,
        content,
        allowedMentions: safeAllowedMentions,
      });
      await this.dependencies.store.recordNudge(
        this.dependencies.guildId,
        channel.channelId,
        now,
      );
      return true;
    } catch (error) {
      this.dependencies.logger?.warn(
        {
          operation: 'quiet_nudge_delivery',
          ...projectOperationalError(error, 'quiet_channel_nudge'),
        },
        'Quiet channel nudge delivery failed.',
      );
      return false;
    }
  }

  private async composeNudge(now: Date, channelId: string): Promise<string> {
    try {
      const response = await this.dependencies.ai.respond({
        instructions: nudgeInstructions,
        history: [],
        prompt: 'Compose the quiet-channel nudge now.',
        safetyIdentifier: `quiet-nudge:${this.dependencies.guildId}:${channelId}:${now.toISOString().slice(0, 13)}`,
      });
      const text = neutralizeDiscordMentions(response.text.trim()).slice(0, 200);
      return text === '' ? fallbackNudge : text;
    } catch (error) {
      this.dependencies.logger?.warn(
        {
          operation: 'quiet_nudge_compose',
          ...projectOperationalError(error, 'quiet_channel_nudge'),
        },
        'Quiet channel nudge composition failed.',
      );
      return fallbackNudge;
    }
  }

  private clock(): Date {
    return (this.dependencies.now ?? (() => new Date()))();
  }
}

export interface QuietChannelNudgeScheduler {
  start(): void;
  stop(): Promise<void>;
}

export class DurableQuietChannelNudgeScheduler
  implements QuietChannelNudgeScheduler
{
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = true;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly service: Pick<QuietChannelNudgeService, 'tick'>,
    private readonly intervalMs = 60_000,
    private readonly logger?: {
      warn(fields: Record<string, unknown>, message: string): void;
    },
  ) {}

  start(): void {
    if (!this.timer) {
      this.stopped = false;
      this.timer = setInterval(() => this.runTick(), this.intervalMs);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await Promise.allSettled([...this.inFlight]);
  }

  private runTick(): void {
    if (this.stopped) return;
    const active = this.service
      .tick()
      .catch((error: unknown) => {
        this.logger?.warn(
          projectOperationalError(error, 'quiet_nudge_scheduler'),
          'Quiet channel nudge scheduler tick failed.',
        );
      })
      .then(() => undefined)
      .finally(() => {
        this.inFlight.delete(active);
      });
    this.inFlight.add(active);
  }
}
