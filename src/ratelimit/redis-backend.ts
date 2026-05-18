import {
  ConsumeResult,
  LimiterBackend,
  TokenBucketLimits,
} from './types';

/**
 * Minimal subset of an ioredis-shaped client we depend on. Typed by structure
 * so the backend can run against ioredis, node-redis with a shim, or a test
 * double - we don't bind to a specific package.
 */
export interface RedisLikeClient {
  eval(
    script: string,
    numKeys: number,
    ...args: ReadonlyArray<string | number>
  ): Promise<unknown>;
}

/**
 * Atomic refill + consume in Redis. The whole bucket update happens inside a
 * single EVAL so two parallel server instances cannot read the same stale
 * state and both decide "allowed" when only one token is left.
 *
 * Returned shape from the script: [allowed: 0|1, tokens: string, retryAfterMs: number]
 * (tokens is a string because Lua's `tostring` on a float keeps precision -
 * Redis would otherwise truncate to integer).
 */
const LUA_TOKEN_BUCKET = `
local capacity = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local data = redis.call('HMGET', KEYS[1], 'tokens', 'last')
local tokens = tonumber(data[1])
local last = tonumber(data[2])

if tokens == nil or last == nil then
  tokens = capacity
  last = now
end

local elapsed = math.max(0, now - last)
tokens = math.min(capacity, tokens + elapsed * refillRate)

local allowed = 0
local retryAfterMs = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  local deficit = 1 - tokens
  retryAfterMs = math.ceil(deficit / refillRate)
  if retryAfterMs < 1 then retryAfterMs = 1 end
end

redis.call('HMSET', KEYS[1], 'tokens', tokens, 'last', now)
local ttlMs = math.ceil(capacity / refillRate) + 60000
redis.call('PEXPIRE', KEYS[1], ttlMs)

return {allowed, tostring(tokens), retryAfterMs}
`;

export class RedisLimiterBackend implements LimiterBackend {
  constructor(private readonly client: RedisLikeClient) {}

  async consume(
    key: string,
    limits: TokenBucketLimits,
    now: number,
  ): Promise<ConsumeResult> {
    const raw = (await this.client.eval(
      LUA_TOKEN_BUCKET,
      1,
      key,
      limits.capacity,
      limits.refillRate,
      now,
    )) as [number, string, number];
    const [allowed, tokensStr, retryAfterMs] = raw;
    return {
      allowed: allowed === 1,
      tokensRemaining: Number(tokensStr),
      retryAfterMs,
    };
  }
}
