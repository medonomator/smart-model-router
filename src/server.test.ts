import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { AddressInfo } from 'node:net';
import { createServer, SERVICE_NAME } from './server';

test('GET /health returns 200 with service marker', async () => {
  const server = createServer().listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const { status, body } = await get(port, '/health');
    assert.equal(status, 200);
    const parsed = JSON.parse(body) as { status: string; service: string };
    assert.equal(parsed.status, 'ok');
    assert.equal(parsed.service, SERVICE_NAME);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('unknown route returns 404', async () => {
  const server = createServer().listen(0);
  const { port } = server.address() as AddressInfo;

  try {
    const { status } = await get(port, '/does-not-exist');
    assert.equal(status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function get(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}
