import { RouteMatch } from '../routing/types';
import { policyKey, selectPolicy } from './policies';
import {
  LimitDecision,
  LimiterBackend,
  RateLimitPolicy,
} from './types';

/**
 * Resolve the applicable policy for this match and consume one token. When no
 * policy applies the request is allowed unconditionally - rate limiting is
 * opt-in per route/pool.
 */
export async function checkAndConsume(
  match: RouteMatch,
  backend: LimiterBackend,
  policies: readonly RateLimitPolicy[],
  now: number,
): Promise<LimitDecision> {
  const policy = selectPolicy(match, policies);
  if (!policy) {
    return {
      allowed: true,
      policyId: null,
      retryAfterMs: 0,
      capacity: 0,
    };
  }
  const result = await backend.consume(policyKey(policy), policy.limits, now);
  return {
    allowed: result.allowed,
    policyId: policy.id,
    retryAfterMs: result.retryAfterMs,
    capacity: policy.limits.capacity,
  };
}
