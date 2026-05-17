import { createServer as createHttpServer, IncomingMessage, ServerResponse } from 'node:http';
import { DEFAULT_ROUTING_TABLE } from './routing/routing-table';
import { lookup } from './routing/router';
import { RoutingTable } from './routing/types';

export const SERVICE_NAME = 'smart-model-router';

export function createServer(table: RoutingTable = DEFAULT_ROUTING_TABLE) {
  return createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? '';
    const url = req.url ?? '';

    if (method === 'GET' && url === '/health') {
      respondJson(res, 200, { status: 'ok', service: SERVICE_NAME });
      return;
    }

    const match = lookup(table, method, url);
    if (match) {
      respondJson(res, 200, {
        route: { method: match.rule.method, path: match.rule.path },
        pool: { name: match.pool.name },
      });
      return;
    }

    respondJson(res, 404, { error: 'not_found' });
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
