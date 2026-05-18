import { BucketState, TokenBucketLimits } from './types';

export interface BucketStep {
  readonly state: BucketState;
  readonly allowed: boolean;
  readonly retryAfterMs: number;
}

/**
 * Single-step refill + consume. Pure function - no I/O, no clock - so it can
 * be unit-tested deterministically and reused verbatim by both the in-memory
 * backend and (in spirit, ported to Lua) the Redis backend.
 *
 * Negative elapsed (clock skew or replay) is clamped to 0 so we never refund
 * tokens.
 */
export function refillAndConsume(
  prev: BucketState,
  limits: TokenBucketLimits,
  now: number,
): BucketStep {
  const elapsed = Math.max(0, now - prev.lastRefillMs);
  const replenished = elapsed * limits.refillRate;
  const tokens = Math.min(limits.capacity, prev.tokens + replenished);

  if (tokens >= 1) {
    return {
      state: { tokens: tokens - 1, lastRefillMs: now },
      allowed: true,
      retryAfterMs: 0,
    };
  }

  const deficit = 1 - tokens;
  const retryAfterMs = Math.max(1, Math.ceil(deficit / limits.refillRate));
  return {
    state: { tokens, lastRefillMs: now },
    allowed: false,
    retryAfterMs,
  };
}

export function freshBucket(
  limits: TokenBucketLimits,
  now: number,
): BucketState {
  return { tokens: limits.capacity, lastRefillMs: now };
}
