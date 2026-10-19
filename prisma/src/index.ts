import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/**
 * Cria o PrismaClient com o driver adapter `pg` (sem query engine binário).
 * `max` limita o pool de conexões por instância da API.
 */
export function createPrismaClient(
  url?: string,
  max = Number(process.env.DATABASE_POOL_MAX ?? 20),
): PrismaClient {
  const connectionString = url ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL não definida');
  const adapter = new PrismaPg({ connectionString, max });
  return new PrismaClient({
    adapter,
    log: process.env.PRISMA_LOG === 'query' ? ['query', 'warn', 'error'] : ['warn'],
  });
}
