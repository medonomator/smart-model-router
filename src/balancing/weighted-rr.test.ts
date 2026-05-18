import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UpstreamPool } from '../routing/types';
import { WeightedRoundRobinBalancer, resetBalancerState } from './weighted-rr';

const pool: UpstreamPool = {
  name: 'p',
  endpoints: [
    { url: 'http://a', status: 'available', weight: 3 },
    { url: 'http://b', status: 'available', weight: 1 },
  ],
};

test('distribution roughly matches weights over many picks', () => {
  resetBalancerState();
  const lb = new WeightedRoundRobinBalancer();
  const counts: Record<string, number> = {};
  for (let i = 0; i < 400; i += 1) {
    const sel = lb.pick(pool);
    if (!sel) continue;
    counts[sel.endpoint.url] = (counts[sel.endpoint.url] ?? 0) + 1;
  }
  // a:b weights are 3:1 -> a should win roughly 3x as often
  assert.ok((counts['http://a'] ?? 0) > (counts['http://b'] ?? 0) * 2);
});

test('unavailable endpoints are skipped', () => {
  resetBalancerState();
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
