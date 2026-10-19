import type { PrismaClient } from '@azhoot/db';
import type { Namespace } from 'socket.io';
import type { Env } from './config/env';
import type { Logger } from './lib/logger';
import type { RedisClient } from './lib/redis';
import type { Metrics } from './lib/metrics';
import type { Storage } from './modules/uploads/storage';

/** Dependências compartilhadas, criadas uma vez por processo (ou por teste). */
export interface AppContext {
  env: Env;
  prisma: PrismaClient;
  redis: RedisClient;
  logger: Logger;
  metrics: Metrics;
  storage: Storage;
  /** Definido após o gateway realtime ser anexado ao servidor HTTP. */
  io?: Namespace;
}
