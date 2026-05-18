export type LimitScope = 'route' | 'pool';

export interface TokenBucketLimits {
  /** Max tokens the bucket can hold. Burst size. */
  readonly capacity: number;
  /** Tokens added per millisecond. e.g. 1/1000 = 1 token per second. */
  readonly refillRate: number;
  /**
   * Hint exposed to clients (e.g. via Retry-After context) describing the
   * "natural" refill window. Not used for arithmetic - the limiter relies on
   * `refillRate` alone for time math.
   */
  readonly refillIntervalMs: number;
}

export interface RateLimitPolicy {
  readonly id: string;
  readonly scope: LimitScope;
  /**
   * When scope='route' this is `"<METHOD> <path>"` (e.g. "POST /v1/chat/completions").
   * When scope='pool' this is the upstream pool name.
   */
  readonly target: string;
  readonly limits: TokenBucketLimits;
}

export interface BucketState {
  readonly tokens: number;
  readonly lastRefillMs: number;
}

export interface ConsumeResult {
  readonly allowed: boolean;
  readonly tokensRemaining: number;
  readonly retryAfterMs: number;
}

/**
 * Storage abstraction for token bucket state. Implementations MUST refill +
 * consume atomically with respect to concurrent calls on the same key (memory
 * backend via single-threaded JS event loop, Redis backend via Lua EVAL).
 */
export interface LimiterBackend {
  consume(
    key: string,
    limits: TokenBucketLimits,
    now: number,
  ): Promise<ConsumeResult>;
}

export interface LimitDecision {
  readonly allowed: boolean;
  readonly policyId: string | null;
  readonly retryAfterMs: number;
  readonly capacity: number;
}
