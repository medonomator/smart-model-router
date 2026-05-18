import { UpstreamEndpoint, UpstreamPool } from '../routing/types';
import { EndpointSelection, LoadBalancer } from './types';

/**
 * Weighted round-robin chooser. Endpoints are picked proportional to weight;
 * status modulates the effective weight (draining gets a hard discount,
 * unavailable is excluded), and `reportFailure` decays a single endpoint's
 * weight to steer traffic away from it.
 *
 * Health state is keyed by `${pool}\x00${url}` so a URL reused across two
 * pools keeps independent counters. All state is per-instance (no module
 * globals); across multiple server instances this is best-effort only - real
 * deployments wanting a shared backplane should plug a different LoadBalancer.
 */

const DRAINING_DISCOUNT = 0.25;
const FAILURE_DECAY = 0.5;
const MIN_WEIGHT = 0.01;
const RECOVERY_HALF_LIFE_MS = 60_000;

interface FailureState {
  readonly multiplier: number;
  readonly updatedAt: number;
}

export interface WeightedRrOptions {
  readonly now?: () => number;
}

export class WeightedRoundRobinBalancer implements LoadBalancer {
  private counter = 0;
  private readonly failures = new Map<string, FailureState>();
  private readonly now: () => number;

  constructor(opts: WeightedRrOptions = {}) {
    this.now = opts.now ?? Date.now;
  }

  pick(pool: UpstreamPool): EndpointSelection | null {
    const candidates = pool.endpoints.filter((e) => e.status !== 'unavailable');
    if (candidates.length === 0) return null;

    const weights = candidates.map((e) => this.effectiveWeight(pool, e));
    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total <= 0) return null;

    const idx = this.counter % total;
    this.counter += 1;

    let running = 0;
    for (let i = 0; i < candidates.length; i += 1) {
      running += weights[i] ?? 0;
      if (idx < running) {
        const endpoint = candidates[i];
        if (endpoint) return { endpoint };
      }
    }
    // Numerically unreachable while total > 0, but the type system can't see
    // that; fall back to the last candidate rather than throwing.
    const last = candidates[candidates.length - 1];
    return last ? { endpoint: last } : null;
  }

  reportFailure(pool: UpstreamPool, endpoint: UpstreamEndpoint): void {
    const key = this.stateKey(pool, endpoint);
    const prev = this.recoveredMultiplier(this.failures.get(key));
    const next = Math.max(MIN_WEIGHT, prev * FAILURE_DECAY);
    this.failures.set(key, { multiplier: next, updatedAt: this.now() });
  }

  private effectiveWeight(
    pool: UpstreamPool,
    endpoint: UpstreamEndpoint,
  ): number {
    const base = (endpoint.weight ?? 1) *
      (endpoint.status === 'draining' ? DRAINING_DISCOUNT : 1);
    const multiplier = this.recoveredMultiplier(
      this.failures.get(this.stateKey(pool, endpoint)),
    );
    return base * multiplier;
  }

  // Failures decay back toward 1.0 with an exponential half-life so a
  // briefly-flaky endpoint isn't punished forever.
  private recoveredMultiplier(state: FailureState | undefined): number {
    if (!state) return 1;
    const elapsed = Math.max(0, this.now() - state.updatedAt);
    const halves = elapsed / RECOVERY_HALF_LIFE_MS;
    const recovered = state.multiplier + (1 - state.multiplier) * (1 - Math.pow(0.5, halves));
    return Math.min(1, Math.max(MIN_WEIGHT, recovered));
  }

  private stateKey(pool: UpstreamPool, endpoint: UpstreamEndpoint): string {
    return `${pool.name}\x00${endpoint.url}`;
  }
}
