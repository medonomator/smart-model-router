import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshBucket, refillAndConsume } from './token-bucket';
import { TokenBucketLimits } from './types';

const limits: TokenBucketLimits = {
  capacity: 5,
  refillRate: 1 / 1000,
  refillIntervalMs: 1000,
};

test('fresh bucket allows the first request and decrements tokens', () => {
  const bucket = freshBucket(limits, 1_000);
  const step = refillAndConsume(bucket, limits, 1_000);
  assert.equal(step.allowed, true);
  assert.equal(step.state.tokens, 4);
  assert.equal(step.retryAfterMs, 0);
});

test('exhaust: capacity consecutive requests at same instant, then deny', () => {
  let state = freshBucket(limits, 0);
  for (let i = 0; i < limits.capacity; i += 1) {
    const step = refillAndConsume(state, limits, 0);
    assert.equal(step.allowed, true, `request ${i + 1} should pass`);
    state = step.state;
  }
  const denied = refillAndConsume(state, limits, 0);
  assert.equal(denied.allowed, false);
  assert.equal(denied.state.tokens < 1, true);
  // refillRate = 0.001 t/ms, deficit = 1 - 0 = 1, retry = ceil(1 / 0.001) = 1000ms
  assert.equal(denied.retryAfterMs, 1000);
});

test('refill: empty bucket + elapsed time restores tokens proportional to rate', () => {
  let state = freshBucket(limits, 0);
  for (let i = 0; i < limits.capacity; i += 1) {
    state = refillAndConsume(state, limits, 0).state;
  }
  const after2s = refillAndConsume(state, limits, 2_000);
  assert.equal(after2s.allowed, true);
  // 2000ms * 0.001 = 2 tokens replenished, consume 1, leaves 1
  assert.equal(after2s.state.tokens, 1);
});

test('refill caps at capacity even after a long idle period', () => {
  const state = freshBucket(limits, 0);
  const step = refillAndConsume(state, limits, 10 * 60 * 1000);
  assert.equal(step.allowed, true);
  assert.equal(step.state.tokens, limits.capacity - 1);
});

test('retryAfterMs reflects how long until a fractional token reaches 1', () => {
  const half: TokenBucketLimits = {
    capacity: 1,
    refillRate: 1 / 500,
    refillIntervalMs: 500,
  };
  let state = freshBucket(half, 0);
  state = refillAndConsume(state, half, 0).state;
  // 250ms later, refilled = 0.5 token, deficit = 0.5, retry = ceil(0.5 / 0.002) = 250ms
  const denied = refillAndConsume(state, half, 250);
  assert.equal(denied.allowed, false);
  assert.equal(denied.retryAfterMs, 250);
});

test('clock skew: now < lastRefillMs is clamped to zero elapsed', () => {
  let state = freshBucket(limits, 1_000);
  state = refillAndConsume(state, limits, 1_000).state;
  const replayed = refillAndConsume(state, limits, 500);
  assert.equal(replayed.allowed, true);
  // Same as if elapsed=0 from a 4-token state -> consumes 1 -> 3 left
  assert.equal(replayed.state.tokens, 3);
});
