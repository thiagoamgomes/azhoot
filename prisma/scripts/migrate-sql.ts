/**
 * Aplica as migrations SQL diretamente via `pg`, registrando-as em `_prisma_migrations`
 * no mesmo formato do Prisma Migrate (checksum SHA-256 do arquivo).
 *
 * Uso recomendado: `pnpm db:migrate` (Prisma Migrate). Este script é um fallback para
 * ambientes sem acesso ao download do schema engine do Prisma (ex.: CI/rede restrita).
 *   pnpm --filter @azhoot/db migrate:sql      # DATABASE_URL
 *   pnpm --filter @azhoot/db migrate:test     # TEST_DATABASE_URL
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const useTest = process.argv.includes('--test');
const url = useTest ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
if (!url) throw new Error(useTest ? 'TEST_DATABASE_URL não definida' : 'DATABASE_URL não definida');

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const client = new pg.Client({ connectionString: url });

await client.connect();
try {
  await client.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(36) PRIMARY KEY NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
  )`);
  const applied = new Set(
    (
      await client.query<{ migration_name: string }>(
        `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
      )
    ).rows.map((r) => r.migration_name),
  );
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, 'migration.sql')))
    .map((d) => d.name)
    .sort();
  let count = 0;
  for (const name of names) {
    if (applied.has(name)) continue;
    const sql = readFileSync(join(dir, name, 'migration.sql'), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const id = randomUUID();
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count) VALUES ($1, $2, now(), $3, 1)`,
        [id, checksum, name],
      );
      await client.query('COMMIT');
      console.log(`✔ ${name}`);
      count++;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  }
  console.log(count ? `${count} migration(s) aplicada(s).` : 'Banco já está atualizado.');
} finally {
  await client.end();
}
