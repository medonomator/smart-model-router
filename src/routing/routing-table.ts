import { RoutingRule, RoutingTable } from './types';
import { UPSTREAM_POOLS, buildPoolIndex } from './upstream-pools';

const RULES: readonly RoutingRule[] = [
  { method: 'POST', path: '/v1/chat/completions', pool: 'llm-chat-default' },
  { method: 'POST', path: '/v1/embeddings', pool: 'llm-embeddings' },
] as const;

export function buildRoutingTable(
  rules: readonly RoutingRule[] = RULES,
  pools = UPSTREAM_POOLS,
): RoutingTable {
  const poolIndex = buildPoolIndex(pools);
  for (const rule of rules) {
    if (!poolIndex.has(rule.pool)) {
      throw new Error(
        `routing rule ${rule.method} ${rule.path} references unknown pool: ${rule.pool}`,
      );
    }
  }
  return { rules, pools: poolIndex };
}

export const DEFAULT_ROUTING_TABLE: RoutingTable = buildRoutingTable();
