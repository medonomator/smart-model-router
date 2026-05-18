import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryLimiterBackend } from './memory-backend';
import { TokenBucketLimits } from './types';

const limits: TokenBucketLimits = {
  capacity: 3,
  refillRate: 1 / 1000,
  refillIntervalMs: 1000,
};

test('backend allows up to capacity requests then denies', async () => {
  const backend = new InMemoryLimiterBackend();
  for (let i = 0; i < 3; i += 1) {
    const r = await backend.consume('k', limits, 0);
    assert.equal(r.allowed, true);
  }
  const denied = await backend.consume('k', limits, 0);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterMs > 0, true);
});

test('different keys keep independent buckets', async () => {
  const backend = new InMemoryLimiterBackend();
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await backend.consume('a', limits, 0)).allowed, true);
  }
  // 'a' is now drained, 'b' is untouched
  assert.equal((await backend.consume('a', limits, 0)).allowed, false);
  assert.equal((await backend.consume('b', limits, 0)).allowed, true);
});

test('refill across a real time gap restores access', async () => {
  const backend = new InMemoryLimiterBackend();
  for (let i = 0; i < 3; i += 1) {
    await backend.consume('k', limits, 0);
  }
  assert.equal((await backend.consume('k', limits, 500)).allowed, false);
  // 1100ms after exhaust -> 1.1 token, request consumes 1 -> allowed
  const after = await backend.consume('k', limits, 1100);
  assert.equal(after.allowed, true);
});
