import { createServer, SERVICE_NAME } from './server';

const port = Number(process.env.PORT) || 3000;
const server = createServer();

server.listen(port, () => {
  console.log(`${SERVICE_NAME} listening on http://localhost:${port}`);
});

const shutdown = (signal: string) => () => {
  console.log(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown('SIGINT'));
process.on('SIGTERM', shutdown('SIGTERM'));
