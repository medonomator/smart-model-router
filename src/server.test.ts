import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { AddressInfo } from 'node:net';
import { createServer, SERVICE_NAME } from './server';

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
    };
    assert.equal(parsed.route.method, 'POST');
    assert.equal(parsed.route.path, '/v1/chat/completions');
    assert.equal(parsed.pool.name, 'llm-chat-default');
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

function send(
  port: number,
  method: string,
  path: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function close(server: { close: (cb: () => void) => void }): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}
