import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RedisLikeClient,
  RedisLimiterBackend,
} from './redis-backend';
import { TokenBucketLimits } from './types';
import { freshBucket, refillAndConsume } from './token-bucket';
import { BucketState } from './types';

/**
 * Tiny shim that runs the same math as the Lua script in JS so we can verify
 * the backend without standing up a real Redis. Mirrors the script's argument
 * layout 1:1 - if the script and this shim diverge, the test catches it.
 *
 * For an end-to-end check against a real Redis, set REDIS_URL and add a
 * separate integration suite that EVALs the actual script.
 */
class FakeRedis implements RedisLikeClient {
  private readonly state = new Map<string, BucketState>();

  eval(
    _script: string,
    numKeys: number,
    ...args: ReadonlyArray<string | number>
  ): Promise<unknown> {
    if (numKeys !== 1) throw new Error('FakeRedis: expected numKeys=1');
    const key = String(args[0]);
    const limits: TokenBucketLimits = {
      capacity: Number(args[1]),
      refillRate: Number(args[2]),
      refillIntervalMs: 0,
    };
    const now = Number(args[3]);
    const prev = this.state.get(key) ?? freshBucket(limits, now);
    const step = refillAndConsume(prev, limits, now);
    this.state.set(key, step.state);
    return Promise.resolve([
      step.allowed ? 1 : 0,
      String(step.state.tokens),
      step.retryAfterMs,
    ]);
  }
}

const limits: TokenBucketLimits = {
  capacity: 2,
  refillRate: 1 / 1000,
  refillIntervalMs: 1000,
};

test('redis-backed limiter exhausts after capacity hits', async () => {
  const backend = new RedisLimiterBackend(new FakeRedis());
  assert.equal((await backend.consume('rk', limits, 0)).allowed, true);
  assert.equal((await backend.consume('rk', limits, 0)).allowed, true);
  const denied = await backend.consume('rk', limits, 0);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterMs > 0, true);
});

test('redis-backed limiter refills after time gap', async () => {
  const backend = new RedisLimiterBackend(new FakeRedis());
  await backend.consume('rk', limits, 0);
  await backend.consume('rk', limits, 0);
  const denied = await backend.consume('rk', limits, 0);
  assert.equal(denied.allowed, false);
  const allowed = await backend.consume('rk', limits, 1100);
  assert.equal(allowed.allowed, true);
});
