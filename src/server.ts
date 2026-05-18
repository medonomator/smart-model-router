import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'node:http';
import { DEFAULT_ROUTING_TABLE } from './routing/routing-table';
import { lookup } from './routing/router';
import { RoutingTable } from './routing/types';
import { checkAndConsume } from './ratelimit/limiter';
import { InMemoryLimiterBackend } from './ratelimit/memory-backend';
import { DEFAULT_RATE_LIMIT_POLICIES } from './ratelimit/policies';
import { LimiterBackend, RateLimitPolicy } from './ratelimit/types';
import { WeightedRoundRobinBalancer } from './balancing/weighted-rr';
import { LoadBalancer } from './balancing/types';

export const SERVICE_NAME = 'smart-model-router';

export interface ServerOptions {
  readonly table?: RoutingTable;
  readonly backend?: LimiterBackend;
  readonly policies?: readonly RateLimitPolicy[];
  readonly clock?: () => number;
  readonly balancer?: LoadBalancer;
}

/**
 * The server stitches together: route lookup -> rate-limit decision -> dispatch.
 * Rate limiting sits AFTER routing on purpose: we want the policy that applies
 * to be derivable from the matched route/pool, and we don't waste a token on a
 * path the table doesn't even recognize.
 */
export function createServer(options: ServerOptions = {}) {
  const table = options.table ?? DEFAULT_ROUTING_TABLE;
  const backend = options.backend ?? new InMemoryLimiterBackend();
  const policies = options.policies ?? DEFAULT_RATE_LIMIT_POLICIES;
  const clock = options.clock ?? Date.now;
  const balancer = options.balancer ?? new WeightedRoundRobinBalancer();

  return createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res, table, backend, policies, clock, balancer).catch((err) => {
      // Backend I/O blew up (e.g. Redis down). Fail closed would lock the
      // whole gateway out the moment Redis hiccups, so we fail open and log;
      // a separate alert/metric is the right place to notice this, not the
      // request path.
      console.error('request handler crashed:', err);
      if (!res.headersSent) respondJson(res, 500, { error: 'internal_error' });
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  table: RoutingTable,
  backend: LimiterBackend,
  policies: readonly RateLimitPolicy[],
  clock: () => number,
  balancer: LoadBalancer,
): Promise<void> {
  const method = req.method ?? '';
  const url = req.url ?? '';

  if (method === 'GET' && url === '/health') {
    respondJson(res, 200, { status: 'ok', service: SERVICE_NAME });
    return;
  }

  const match = lookup(table, method, url);
  if (!match) {
    respondJson(res, 404, { error: 'not_found' });
    return;
  }

  const decision = await checkAndConsume(match, backend, policies, clock());
  if (!decision.allowed) {
    const retryAfterSec = Math.max(1, Math.ceil(decision.retryAfterMs / 1000));
    res.setHeader('retry-after', String(retryAfterSec));
    respondJson(res, 429, {
      error: 'rate_limited',
      reason: 'token bucket exhausted',
      policy: decision.policyId,
      retryAfterMs: decision.retryAfterMs,
      capacity: decision.capacity,
    });
    return;
  }

  const selected = balancer.pick(match.pool);
  respondJson(res, 200, {
    route: { method: match.rule.method, path: match.rule.path },
    pool: { name: match.pool.name },
    upstream: selected
      ? { url: selected.endpoint.url, status: selected.endpoint.status }
      : null,
  });
}

function respondJson(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
