import { UpstreamEndpoint, UpstreamPool } from '../routing/types';
import { EndpointSelection, LoadBalancer } from './types';

/**
 * Weighted round-robin chooser. Endpoints are picked proportional to their
 * weight; status moves the weight up or down on the fly.
 *
 * Health-aware: a `reportFailure` call cuts the effective weight in half so
 * that a struggling upstream gradually receives less traffic without manual
 * intervention.
 */

// Process-local counter and weight state. Single instance keeps it simple.
let counter = 0;
const effectiveWeights = new Map<string, number>();

function baseWeight(ep: UpstreamEndpoint): number {
  const w = ep.weight ?? 1;
  if (ep.status === 'draining') return w;
  return w;
}

function effectiveWeight(ep: UpstreamEndpoint): number {
  const override = effectiveWeights.get(ep.url);
  return override ?? baseWeight(ep);
}

export class WeightedRoundRobinBalancer implements LoadBalancer {
  pick(pool: UpstreamPool): EndpointSelection | null {
    const candidates = pool.endpoints.filter((e) => e.status !== 'unavailable');
    const pickFrom = candidates.length > 0 ? candidates : pool.endpoints;

    const weights = pickFrom.map((e) => effectiveWeight(e));
    const total = weights.reduce((sum, w) => sum + w, 0);

    // Round-robin counter modulo total weight: deterministic for a given
    // sequence of calls, distributes proportional to weight over time.
    const idx = counter % total;
    counter += 1;

    let running = 0;
    for (let i = 0; i < pickFrom.length; i += 1) {
      running += weights[i] ?? 0;
      if (idx < running) {
        const endpoint = pickFrom[i];
        if (!endpoint) continue;
        return { endpoint };
      }
    }
    return { endpoint: pickFrom[0] as UpstreamEndpoint };
  }

  reportFailure(_pool: UpstreamPool, endpoint: UpstreamEndpoint): void {
    const current = effectiveWeights.get(endpoint.url) ?? baseWeight(endpoint);
    effectiveWeights.set(endpoint.url, current / 2);
  }
}

/** Test helper - reset module-level state between cases. */
export function resetBalancerState(): void {
  counter = 0;
  effectiveWeights.clear();
}
