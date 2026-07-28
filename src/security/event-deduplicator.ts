export class EventDeduplicator {
  private readonly acceptedAtByEventId = new Map<string, number>();

  public constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {
    if (
      !Number.isInteger(ttlMs) ||
      !Number.isInteger(maxEntries) ||
      ttlMs <= 0 ||
      maxEntries <= 0
    ) {
      throw new RangeError(
        'Event deduplicator bounds must be positive integers',
      );
    }
  }

  public get size(): number {
    return this.acceptedAtByEventId.size;
  }

  public accept(eventId: string, now = Date.now()): boolean {
    this.prune(now);

    if (this.acceptedAtByEventId.has(eventId)) {
      return false;
    }

    this.acceptedAtByEventId.set(eventId, now);
    this.enforceMaximumEntries();
    return true;
  }

  public release(eventId: string): void {
    this.acceptedAtByEventId.delete(eventId);
  }

  public prune(now = Date.now()): void {
    const cutoff = now - this.ttlMs;

    for (const [eventId, acceptedAt] of this.acceptedAtByEventId) {
      if (acceptedAt <= cutoff) {
        this.acceptedAtByEventId.delete(eventId);
      }
    }
  }

  private enforceMaximumEntries(): void {
    while (this.acceptedAtByEventId.size > this.maxEntries) {
      const oldestEventId = this.acceptedAtByEventId.keys().next().value;
      if (oldestEventId === undefined) {
        return;
      }
      this.acceptedAtByEventId.delete(oldestEventId);
    }
  }
}
