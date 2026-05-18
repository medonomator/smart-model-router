import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { AddressInfo } from 'node:net';
import { createServer, SERVICE_NAME } from './server';
import { InMemoryLimiterBackend } from './ratelimit/memory-backend';
import { RateLimitPolicy } from './ratelimit/types';

test('GET /health returns 200 with service marker', async () => {
  const server = createServer().listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const { status, body } = await send(port, 'GET', '/health');
    assert.equal(status, 200);
    const parsed = JSON.parse(body) as { status: string; service: string };
    assert.equal(parsed.status, 'ok');
    assert.equal(parsed.service, SERVICE_NAME);
  } finally {
    await close(server);
  }
});

test('unknown route returns 404', async () => {
  const server = createServer().listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const { status, body } = await send(port, 'GET', '/does-not-exist');
    assert.equal(status, 404);
    const parsed = JSON.parse(body) as { error: string };
    assert.equal(parsed.error, 'not_found');
  } finally {
    await close(server);
  }
});

test('known route is dispatched to its upstream pool', async () => {
  const server = createServer().listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const { status, body } = await send(port, 'POST', '/v1/chat/completions');
    assert.equal(status, 200);
    const parsed = JSON.parse(body) as {
      route: { method: string; path: string };
      pool: { name: string };
      upstream: { url: string; status: string } | null;
    };
    assert.equal(parsed.route.method, 'POST');
    assert.equal(parsed.route.path, '/v1/chat/completions');
    assert.equal(parsed.pool.name, 'llm-chat-default');
    assert.ok(parsed.upstream);
    assert.ok(parsed.upstream?.url.startsWith('http://'));
  } finally {
    await close(server);
  }
});

test('method that is not in the table returns 404 even on a known path', async () => {
  const server = createServer().listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const { status } = await send(port, 'GET', '/v1/chat/completions');
    assert.equal(status, 404);
  } finally {
    await close(server);
  }
});

// Tight policy so the test can exhaust the bucket in a couple of requests
// without hammering the network. Single-shared backend so the requests share
// the bucket - that's the realistic deployment.
const tightPolicy: RateLimitPolicy = {
  id: 'pool:llm-chat-default',
  scope: 'pool',
  target: 'llm-chat-default',
  limits: { capacity: 2, refillRate: 1 / 1000, refillIntervalMs: 1000 },
};

test('exhausted bucket responds 429 with retry-after header and policy id', async () => {
  let now = 0;
  const backend = new InMemoryLimiterBackend();
  const server = createServer({
    backend,
    policies: [tightPolicy],
    clock: () => now,
  }).listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    assert.equal((await send(port, 'POST', '/v1/chat/completions')).status, 200);
    assert.equal((await send(port, 'POST', '/v1/chat/completions')).status, 200);

    const denied = await send(port, 'POST', '/v1/chat/completions');
    assert.equal(denied.status, 429);
    assert.equal(denied.headers['retry-after'], '1');
    const body = JSON.parse(denied.body) as {
      error: string;
      policy: string;
      retryAfterMs: number;
      capacity: number;
    };
    assert.equal(body.error, 'rate_limited');
    assert.equal(body.policy, tightPolicy.id);
    assert.equal(body.capacity, 2);
    assert.equal(body.retryAfterMs > 0, true);
  } finally {
    await close(server);
  }
});

test('bucket refills as virtual clock advances', async () => {
  let now = 0;
  const backend = new InMemoryLimiterBackend();
  const server = createServer({
    backend,
    policies: [tightPolicy],
    clock: () => now,
  }).listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    await send(port, 'POST', '/v1/chat/completions');
    await send(port, 'POST', '/v1/chat/completions');
    assert.equal((await send(port, 'POST', '/v1/chat/completions')).status, 429);

    now = 1500; // 1.5 tokens refilled, enough for one more pass
    assert.equal((await send(port, 'POST', '/v1/chat/completions')).status, 200);
  } finally {
    await close(server);
  }
});

function send(
  port: number,
  method: string,
  path: string,
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          body,
          headers: res.headers as Record<string, string>,
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

function close(server: { close: (cb: () => void) => void }): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
