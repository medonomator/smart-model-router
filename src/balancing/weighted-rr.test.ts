import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UpstreamPool } from '../routing/types';
import { WeightedRoundRobinBalancer } from './weighted-rr';

const basicPool: UpstreamPool = {
  name: 'p',
  endpoints: [
    { url: 'http://a', status: 'available', weight: 3 },
    { url: 'http://b', status: 'available', weight: 1 },
  ],
};

function countPicks(lb: WeightedRoundRobinBalancer, pool: UpstreamPool, n: number) {
  const counts: Record<string, number> = {};
  for (let i = 0; i < n; i += 1) {
    const sel = lb.pick(pool);
    if (!sel) continue;
    counts[sel.endpoint.url] = (counts[sel.endpoint.url] ?? 0) + 1;
  }
  return counts;
}

test('distribution roughly matches weights over many picks', () => {
  const lb = new WeightedRoundRobinBalancer();
  const counts = countPicks(lb, basicPool, 400);
  assert.ok((counts['http://a'] ?? 0) > (counts['http://b'] ?? 0) * 2);
});

test('unavailable endpoints are skipped', () => {
  const poolWithDown: UpstreamPool = {
    name: 'p',
    endpoints: [
      { url: 'http://dead', status: 'unavailable', weight: 5 },
      { url: 'http://live', status: 'available', weight: 5 },
    ],
  };
  const lb = new WeightedRoundRobinBalancer();
  for (let i = 0; i < 20; i += 1) {
    const sel = lb.pick(poolWithDown);
    assert.equal(sel?.endpoint.url, 'http://live');
  }
});

test('pool with only unavailable endpoints returns null', () => {
  const allDown: UpstreamPool = {
    name: 'p',
    endpoints: [
      { url: 'http://x', status: 'unavailable', weight: 1 },
      { url: 'http://y', status: 'unavailable', weight: 1 },
    ],
  };
  const lb = new WeightedRoundRobinBalancer();
  assert.equal(lb.pick(allDown), null);
});

test('draining endpoints get less traffic than available at same base weight', () => {
  const mixed: UpstreamPool = {
    name: 'p',
    endpoints: [
      { url: 'http://drain', status: 'draining', weight: 5 },
      { url: 'http://live', status: 'available', weight: 5 },
    ],
  };
  const lb = new WeightedRoundRobinBalancer();
  const counts = countPicks(lb, mixed, 400);
  assert.ok((counts['http://live'] ?? 0) > (counts['http://drain'] ?? 0) * 2);
  // draining is still in the rotation, just discounted
  assert.ok((counts['http://drain'] ?? 0) > 0);
});

test('reportFailure shifts traffic toward the healthy endpoint', () => {
  let now = 0;
  const lb = new WeightedRoundRobinBalancer({ now: () => now });
  const evenPool: UpstreamPool = {
    name: 'p',
    endpoints: [
      { url: 'http://a', status: 'available', weight: 5 },
      { url: 'http://b', status: 'available', weight: 5 },
    ],
  };

  const baseline = countPicks(lb, evenPool, 200);
  const ratioBefore = (baseline['http://a'] ?? 0) / Math.max(1, baseline['http://b'] ?? 0);

  // Report several failures against `a` so its weight decays well below `b`.
  for (let i = 0; i < 4; i += 1) {
    lb.reportFailure(evenPool, evenPool.endpoints[0]!);
  }

  const after = countPicks(lb, evenPool, 200);
  const ratioAfter = (after['http://a'] ?? 0) / Math.max(1, after['http://b'] ?? 0);
  assert.ok(ratioAfter < ratioBefore, `expected ratio to drop, got ${ratioBefore} -> ${ratioAfter}`);
  assert.ok((after['http://b'] ?? 0) > (after['http://a'] ?? 0));
});

test('failure state does not leak across pools with the same url', () => {
  let now = 0;
  const lb = new WeightedRoundRobinBalancer({ now: () => now });
  const poolA: UpstreamPool = {
    name: 'pool-a',
    endpoints: [
      { url: 'http://shared', status: 'available', weight: 5 },
      { url: 'http://other', status: 'available', weight: 5 },
    ],
  };
  const poolB: UpstreamPool = {
    name: 'pool-b',
    endpoints: [
      { url: 'http://shared', status: 'available', weight: 5 },
      { url: 'http://other-b', status: 'available', weight: 5 },
    ],
  };

  for (let i = 0; i < 6; i += 1) {
    lb.reportFailure(poolA, poolA.endpoints[0]!);
  }

  // Pool B should still distribute roughly evenly; the failure on pool A
  // must not contaminate its sibling.
  const counts = countPicks(lb, poolB, 200);
  const shared = counts['http://shared'] ?? 0;
  const other = counts['http://other-b'] ?? 0;
  const ratio = shared / Math.max(1, other);
  assert.ok(ratio > 0.7 && ratio < 1.4, `pool-b should be ~even, got ${shared}:${other}`);
});

test('failure weight recovers over time toward 1.0', () => {
  let now = 0;
  const lb = new WeightedRoundRobinBalancer({ now: () => now });
  const pool: UpstreamPool = {
    name: 'p',
    endpoints: [
      { url: 'http://a', status: 'available', weight: 5 },
      { url: 'http://b', status: 'available', weight: 5 },
    ],
  };

  for (let i = 0; i < 5; i += 1) {
    lb.reportFailure(pool, pool.endpoints[0]!);
  }
  const punished = countPicks(lb, pool, 200);
  assert.ok((punished['http://b'] ?? 0) > (punished['http://a'] ?? 0) * 3);

  // Fast-forward many half-lives; failure multiplier should converge near 1.
  now += 60_000 * 20;
  const recovered = countPicks(lb, pool, 400);
  const ratio = (recovered['http://a'] ?? 0) / Math.max(1, recovered['http://b'] ?? 0);
  assert.ok(ratio > 0.7 && ratio < 1.4, `expected ~even after recovery, got ${ratio}`);
});
