import { startServer } from './server';

const server = await startServer();

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  server.ctx.logger.info({ signal }, 'encerrando');
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  await server.close();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (err) =>
  server.ctx.logger.error({ err }, 'promise rejeitada sem tratamento'),
);
