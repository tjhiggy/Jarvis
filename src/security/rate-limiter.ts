export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export class RateLimiter {
  private readonly eventsByKey = new Map<string, number[]>();

  public constructor(
    private readonly capacity: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {
    if (
      !Number.isInteger(capacity) ||
      !Number.isInteger(windowMs) ||
      !Number.isInteger(maxKeys) ||
      capacity <= 0 ||
      windowMs <= 0 ||
      maxKeys <= 0
    ) {
      throw new RangeError('Rate limiter bounds must be positive integers');
    }
  }

  public get size(): number {
    return this.eventsByKey.size;
  }

  public consume(key: string, now = Date.now()): RateLimitResult {
    this.prune(now);

    const events = this.eventsByKey.get(key) ?? [];
    this.eventsByKey.delete(key);
    this.eventsByKey.set(key, events);

    if (events.length >= this.capacity) {
      return {
        allowed: false,
        retryAfterMs: events[0]! + this.windowMs - now,
      };
    }

    events.push(now);
    this.enforceMaximumKeys();
    return { allowed: true, retryAfterMs: 0 };
  }

  public prune(now = Date.now()): void {
    const cutoff = now - this.windowMs;

    for (const [key, events] of this.eventsByKey) {
      const firstActiveIndex = events.findIndex((event) => event > cutoff);
      if (firstActiveIndex === -1) {
        this.eventsByKey.delete(key);
      } else if (firstActiveIndex > 0) {
        events.splice(0, firstActiveIndex);
      }
    }
  }

  private enforceMaximumKeys(): void {
    while (this.eventsByKey.size > this.maxKeys) {
      const oldestKey = this.eventsByKey.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }
      this.eventsByKey.delete(oldestKey);
    }
  }
}
