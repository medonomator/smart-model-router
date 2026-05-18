import { createServer, SERVICE_NAME } from './server';
import { InMemoryLimiterBackend } from './ratelimit/memory-backend';
import { RedisLimiterBackend, RedisLikeClient } from './ratelimit/redis-backend';
import { LimiterBackend } from './ratelimit/types';

const port = Number(process.env.PORT) || 3000;
const backend = pickBackend();
const server = createServer({ backend });

server.listen(port, () => {
  console.log(`${SERVICE_NAME} listening on http://localhost:${port}`);
});

const shutdown = (signal: string) => () => {
  console.log(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown('SIGINT'));
process.on('SIGTERM', shutdown('SIGTERM'));

function pickBackend(): LimiterBackend {
  const choice = (process.env.RATE_LIMIT_BACKEND ?? 'memory').toLowerCase();
  if (choice === 'redis') {
    // ioredis is loaded lazily and via dynamic require so the package stays
    // optional: a memory-backed deployment never needs to install it.
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('RATE_LIMIT_BACKEND=redis requires REDIS_URL');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Redis = require('ioredis') as new (url: string) => RedisLikeClient;
    return new RedisLimiterBackend(new Redis(url));
  }
  return new InMemoryLimiterBackend();
}
