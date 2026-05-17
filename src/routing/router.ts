import { HttpMethod, RouteMatch, RoutingTable } from './types';

const KNOWN_METHODS: readonly HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
];

function isHttpMethod(value: string): value is HttpMethod {
  return (KNOWN_METHODS as readonly string[]).includes(value);
}

export function lookup(
  table: RoutingTable,
  method: string,
  path: string,
): RouteMatch | null {
  if (!isHttpMethod(method)) return null;
  const normalizedPath = stripQuery(path);
  for (const rule of table.rules) {
    if (rule.method === method && rule.path === normalizedPath) {
      const pool = table.pools.get(rule.pool);
      if (!pool) return null;
      return { rule, pool };
    }
  }
  return null;
}

function stripQuery(path: string): string {
  const q = path.indexOf('?');
  return q === -1 ? path : path.slice(0, q);
}
