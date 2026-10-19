import { createServer as createHttpServer, type Server } from 'node:http';
import { resolve } from 'node:path';
import { createPrismaClient } from '@azhoot/db';
import { createApp } from './app';
import { loadEnv, type Env } from './config/env';
import type { AppContext } from './context';
import { createLogger } from './lib/logger';
import { Metrics } from './lib/metrics';
import { createRedis } from './lib/redis';
import { GameEngine } from './modules/game/engine';
import { attachGateway } from './modules/game/gateway';
import { startBillingJobs } from './modules/billing/jobs';
import { applyRetention } from './modules/reports/service';
import { getSettings } from './modules/settings/service';
import { LocalStorage } from './modules/uploads/storage';

export interface RunningServer {
  ctx: AppContext;
  engine: GameEngine;
  http: Server;
  port: number;
  close: () => Promise<void>;
}

export async function startServer(
  overrides: Record<string, string | undefined> = {},
  port?: number,
): Promise<RunningServer> {
  const env: Env = loadEnv(overrides);
  const logger = createLogger(
    env.LOG_LEVEL,
    env.NODE_ENV === 'development' && process.stdout.isTTY,
  );
  const ctx: AppContext = {
    env,
    logger,
    prisma: createPrismaClient(env.DATABASE_URL),
    redis: createRedis(env.REDIS_URL),
    metrics: new Metrics(),
    storage: new LocalStorage(resolve(env.UPLOAD_DIR)),
  };
  const engine = new GameEngine(ctx);
  const app = createApp(ctx, engine);
  const http = createHttpServer(app);
  const io = await attachGateway(ctx, http, engine);

  await new Promise<void>((res) => http.listen(port ?? env.API_PORT, res));
  const address = http.address();
  const actualPort = typeof address === 'object' && address ? address.port : env.API_PORT;

  await engine.recover();
  const stopJobs =
    process.env.DISABLE_JOBS === '1' || env.NODE_ENV === 'test'
      ? () => undefined
      : startBillingJobs(ctx);

  // Manutenção periódica: sessões esquecidas e política de retenção.
  const maintenance = setInterval(
    async () => {
      try {
        await engine.expireStale(24);
        const s = await getSettings(ctx);
        await applyRetention(ctx, s.retentionDays, s.deletionMode);
      } catch (err) {
        logger.warn({ err }, 'falha na manutenção periódica');
      }
    },
    10 * 60 * 1000,
  );
  maintenance.unref();

  logger.info({ port: actualPort, env: env.NODE_ENV }, 'AZhoot API em execução');

  const close = async () => {
    clearInterval(maintenance);
    stopJobs();
    engine.stop();
    await new Promise<void>((res) => io.close(() => res()));
    await new Promise<void>((res) => (http.listening ? http.close(() => res()) : res()));
    await ctx.prisma.$disconnect();
    ctx.redis.disconnect();
  };

  return { ctx, engine, http, port: actualPort, close };
}
