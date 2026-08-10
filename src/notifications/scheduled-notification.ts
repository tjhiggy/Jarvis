export interface ScheduledNotificationItem { readonly id: string; readonly title: string; readonly url: string; readonly publishedAt?: string; }
export interface ScheduledNotificationStore { isPaused(serverId: string): Promise<boolean>; claim(key: string): Promise<boolean>; }
export interface ScheduledNotificationPublisher { publish(channelId: string, item: ScheduledNotificationItem): Promise<void>; }

export class ScheduledNotificationService {
  constructor(private readonly store: ScheduledNotificationStore, private readonly publisher: ScheduledNotificationPublisher, private readonly channelId: string, private readonly serverId = 'default') {}
  async publish(items: readonly ScheduledNotificationItem[]): Promise<number> {
    if (!this.channelId || await this.store.isPaused(this.serverId)) return 0;
    let count = 0;
    for (const item of items.slice(0, 20)) {
      if (!item.id || !item.title || !item.url || !(await this.store.claim(`${this.serverId}:${item.id}`))) continue;
      await this.publisher.publish(this.channelId, item); count += 1;
    }
    return count;
  }
}
