import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoutingTable, DEFAULT_ROUTING_TABLE } from './routing-table';
import { lookup } from './router';

test('lookup matches a known method+path to the expected pool', () => {
  const match = lookup(
    DEFAULT_ROUTING_TABLE,
    'POST',
    '/v1/chat/completions',
  );
  assert.ok(match, 'expected a routing match');
  assert.equal(match.pool.name, 'llm-chat-default');
  assert.ok(match.pool.endpoints.length > 0);
});

test('lookup returns null for unknown path', () => {
  const match = lookup(DEFAULT_ROUTING_TABLE, 'POST', '/nope');
  assert.equal(match, null);
});

test('lookup returns null when method does not match the rule', () => {
  const match = lookup(DEFAULT_ROUTING_TABLE, 'GET', '/v1/chat/completions');
  assert.equal(match, null);
});

test('lookup ignores query string', () => {
  const match = lookup(
    DEFAULT_ROUTING_TABLE,
    'POST',
    '/v1/chat/completions?trace=1',
  );
  assert.ok(match);
  assert.equal(match.pool.name, 'llm-chat-default');
});

test('lookup returns null for non-standard method', () => {
  const match = lookup(DEFAULT_ROUTING_TABLE, 'OPTIONS', '/v1/chat/completions');
  assert.equal(match, null);
});

test('buildRoutingTable throws if a rule references unknown pool', () => {
  assert.throws(
    () =>
      buildRoutingTable(
        [{ method: 'POST', path: '/x', pool: 'ghost' }],
        [{ name: 'real', endpoints: [] }],
      ),
    /unknown pool: ghost/,
  );
});

test('buildRoutingTable throws on duplicate pool names', () => {
  assert.throws(
    () =>
      buildRoutingTable(
        [],
        [
          { name: 'a', endpoints: [] },
          { name: 'a', endpoints: [] },
        ],
      ),
    /duplicate upstream pool name: a/,
  );
});
