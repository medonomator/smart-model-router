import { UpstreamPool } from './types';

export const UPSTREAM_POOLS: readonly UpstreamPool[] = [
  {
    name: 'llm-chat-default',
    endpoints: [
      { url: 'http://upstream-openai.mock/v1', status: 'available' },
      { url: 'http://upstream-anthropic.mock/v1', status: 'available' },
    ],
  },
  {
    name: 'llm-embeddings',
    endpoints: [
      { url: 'http://upstream-openai.mock/v1', status: 'available' },
    ],
  },
] as const;

export function buildPoolIndex(
  pools: readonly UpstreamPool[],
): ReadonlyMap<string, UpstreamPool> {
  const index = new Map<string, UpstreamPool>();
  for (const pool of pools) {
    if (index.has(pool.name)) {
      throw new Error(`duplicate upstream pool name: ${pool.name}`);
    }
    index.set(pool.name, pool);
  }
  return index;
}
