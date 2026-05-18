import { RouteMatch } from '../routing/types';
import { RateLimitPolicy } from './types';

/**
 * Default policies. Pool-scoped limits express "this upstream is expensive,
 * the whole tenant traffic to it must fit under N RPS". Route-level limits
 * (commented example) can sit on top to gate a single hot path more tightly
 * without touching the rest of the pool. Route wins over pool when both
 * match - see `selectPolicy` below.
 */
export const DEFAULT_RATE_LIMIT_POLICIES: readonly RateLimitPolicy[] = [
  {
    id: 'pool:llm-chat-default',
    scope: 'pool',
    target: 'llm-chat-default',
    // 60-token burst, sustained 1 rps. Tuned so a normal interactive client
    // is invisible but a runaway script gets cut off inside a minute.
    limits: {
      capacity: 60,
      refillRate: 1 / 1000,
      refillIntervalMs: 1000,
    },
  },
  {
    id: 'pool:llm-embeddings',
    scope: 'pool',
    target: 'llm-embeddings',
    // Embeddings are cheap - allow 2 rps with a 120-burst.
    limits: {
      capacity: 120,
      refillRate: 2 / 1000,
      refillIntervalMs: 1000,
    },
  },
];

/**
 * Pick the most specific policy that applies to this routing decision.
 * Route-scope wins over pool-scope so a hot path can be tightened without
 * rewriting pool defaults. Returns null when no policy matches (request is
 * unlimited).
 */
export function selectPolicy(
  match: RouteMatch,
  policies: readonly RateLimitPolicy[] = DEFAULT_RATE_LIMIT_POLICIES,
): RateLimitPolicy | null {
  const routeTarget = `${match.rule.method} ${match.rule.path}`;
  const routeHit = policies.find(
    (p) => p.scope === 'route' && p.target === routeTarget,
  );
  if (routeHit) return routeHit;
  const poolHit = policies.find(
    (p) => p.scope === 'pool' && p.target === match.pool.name,
  );
  return poolHit ?? null;
}

export function policyKey(policy: RateLimitPolicy): string {
  return `rl:${policy.scope}:${policy.target}`;
}
