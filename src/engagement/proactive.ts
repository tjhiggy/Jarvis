import { neutralizeDiscordMentions } from '../utils/mentions.js';

export type ProactiveState = 'disabled' | 'enabled' | 'paused';

export interface ProactiveGateway {
  post(channelId: string, content: string): Promise<void>;
}

export interface ProactiveStore {
  get(guildId: string): Promise<{ state: ProactiveState; lastPostedAt?: Date } | undefined>;
  set(guildId: string, state: ProactiveState, updatedAt: Date): Promise<void>;
  claim(guildId: string, key: string, now: Date): Promise<boolean>;
}

export const DEFAULT_PROACTIVE_TEMPLATES = Object.freeze([
  'Crew check-in: what is everyone playing, building, or exploring today?',
  'MuthaShip prompt: share one win from this week so the crew can celebrate it.',
  'Open comms: what should Jarvis help the crew coordinate next?',
]);

export const buildProactivePreview = (template = DEFAULT_PROACTIVE_TEMPLATES[0] ?? ''): string =>
  neutralizeDiscordMentions(template).slice(0, 1_000);

export class ProactiveEngagementService {
  constructor(
    private readonly dependencies: Readonly<{
      store: ProactiveStore;
      gateway: ProactiveGateway;
      channelId: string;
      guildId: string;
      now?: () => Date;
      quietHours?: readonly [number, number];
      minIntervalMs?: number;
      templates?: readonly string[];
    }>,
  ) {}

  async status(): Promise<{ state: ProactiveState; lastPostedAt?: Date }> {
    return (await this.dependencies.store.get(this.dependencies.guildId)) ?? { state: 'disabled' };
  }

  async setState(state: Exclude<ProactiveState, 'disabled'> | 'disabled'): Promise<void> {
    await this.dependencies.store.set(this.dependencies.guildId, state, this.clock());
  }

  async preview(template?: string): Promise<string> {
    return buildProactivePreview(template ?? this.dependencies.templates?.[0] ?? DEFAULT_PROACTIVE_TEMPLATES[0]);
  }

  async tick(): Promise<boolean> {
    const current = await this.status();
    if (current.state !== 'enabled' || this.dependencies.channelId === '') return false;
    const now = this.clock();
    if (this.inQuietHours(now) || (current.lastPostedAt && now.getTime() - current.lastPostedAt.getTime() < (this.dependencies.minIntervalMs ?? 6 * 60 * 60_000))) return false;
    const key = `${now.toISOString().slice(0, 13)}`;
    if (!(await this.dependencies.store.claim(this.dependencies.guildId, key, now))) return false;
    const templates = this.dependencies.templates?.length ? this.dependencies.templates : DEFAULT_PROACTIVE_TEMPLATES;
    await this.dependencies.gateway.post(this.dependencies.channelId, buildProactivePreview(templates[Math.floor(now.getTime() / 3_600_000) % templates.length]));
    await this.dependencies.store.set(this.dependencies.guildId, 'enabled', now);
    return true;
  }

  private clock(): Date { return (this.dependencies.now ?? (() => new Date()))(); }
  private inQuietHours(now: Date): boolean {
    const [start, end] = this.dependencies.quietHours ?? [23, 8];
    const hour = now.getHours();
    return start > end ? hour >= start || hour < end : hour >= start && hour < end;
  }
}
