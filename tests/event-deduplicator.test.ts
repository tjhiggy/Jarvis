import { describe, expect, it } from 'vitest';
import { EventDeduplicator } from '../src/security/event-deduplicator.js';

describe('EventDeduplicator', () => {
  it('accepts an event ID the first time it is seen', () => {
    const deduplicator = new EventDeduplicator(1_000, 10);

    expect(deduplicator.accept('event-1', 10_000)).toBe(true);
  });

  it('rejects a duplicate event ID before its TTL expires', () => {
    const deduplicator = new EventDeduplicator(1_000, 10);

    deduplicator.accept('event-1', 10_000);

    expect(deduplicator.accept('event-1', 10_999)).toBe(false);
  });

  it('accepts an event ID again once its TTL reaches the expiry boundary', () => {
    const deduplicator = new EventDeduplicator(1_000, 10);

    deduplicator.accept('event-1', 10_000);

    expect(deduplicator.accept('event-1', 11_000)).toBe(true);
  });

  it('evicts the oldest entry when its maximum entry count is reached', () => {
    const deduplicator = new EventDeduplicator(1_000, 2);

    deduplicator.accept('event-1', 10_000);
    deduplicator.accept('event-2', 10_100);
    deduplicator.accept('event-3', 10_200);

    expect(deduplicator.accept('event-1', 10_300)).toBe(true);
    expect(deduplicator.size).toBe(2);
  });

  it('prunes expired entries', () => {
    const deduplicator = new EventDeduplicator(1_000, 10);

    deduplicator.accept('expired', 10_000);
    deduplicator.accept('retained', 10_900);
    deduplicator.prune(11_000);

    expect(deduplicator.size).toBe(1);
  });

  it('rejects non-positive bounds', () => {
    expect(() => new EventDeduplicator(0, 10)).toThrow(RangeError);
    expect(() => new EventDeduplicator(1_000, 0)).toThrow(RangeError);
  });
});
