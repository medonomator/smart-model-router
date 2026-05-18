import {
  ConsumeResult,
  LimiterBackend,
  TokenBucketLimits,
} from './types';
import { freshBucket, refillAndConsume } from './token-bucket';
import { BucketState } from './types';

/**
 * Process-local backend. Safe because Node is single-threaded - the
 * refill+consume math runs synchronously between `await`s. Across multiple
 * server instances this backend does NOT share state: when you scale out,
 * switch to the Redis backend.
 */
export class InMemoryLimiterBackend implements LimiterBackend {
  private readonly store = new Map<string, BucketState>();

  consume(
    key: string,
    limits: TokenBucketLimits,
    now: number,
  ): Promise<ConsumeResult> {
    const prev = this.store.get(key) ?? freshBucket(limits, now);
    const step = refillAndConsume(prev, limits, now);
    this.store.set(key, step.state);
    return Promise.resolve({
      allowed: step.allowed,
      tokensRemaining: step.state.tokens,
      retryAfterMs: step.retryAfterMs,
    });
  }

  /** Test helper - drop all state. Not exposed via LimiterBackend. */
  reset(): void {
    this.store.clear();
  }
}
