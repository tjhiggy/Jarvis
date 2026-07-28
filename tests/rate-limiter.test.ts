import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/security/rate-limiter.js';

describe('RateLimiter', () => {
  it('allows up to its capacity within a window', () => {
    const limiter = new RateLimiter(2, 1_000, 10);

    expect(limiter.consume('guild:user', 10_000)).toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
    expect(limiter.consume('guild:user', 10_100)).toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
  });

  it('rejects the event after capacity with a positive retry delay', () => {
    const limiter = new RateLimiter(2, 1_000, 10);

    limiter.consume('guild:user', 10_000);
    limiter.consume('guild:user', 10_100);

    expect(limiter.consume('guild:user', 10_500)).toEqual({
      allowed: false,
      retryAfterMs: 500,
    });
  });

  it('restores allowance after the oldest event reaches the window boundary', () => {
    const limiter = new RateLimiter(1, 1_000, 10);

    limiter.consume('guild:user', 10_000);

    expect(limiter.consume('guild:user', 11_000)).toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
  });

  it('prunes inactive keys', () => {
    const limiter = new RateLimiter(1, 1_000, 10);

    limiter.consume('inactive', 10_000);
    limiter.consume('active', 10_900);
    limiter.prune(11_000);

    expect(limiter.size).toBe(1);
  });

  it('rejects non-positive bounds', () => {
    expect(() => new RateLimiter(0, 1_000, 10)).toThrow(RangeError);
    expect(() => new RateLimiter(1, 0, 10)).toThrow(RangeError);
    expect(() => new RateLimiter(1, 1_000, 0)).toThrow(RangeError);
  });
});
