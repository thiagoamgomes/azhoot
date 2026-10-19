import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/** Carrega o `.env` da raiz do monorepo em desenvolvimento/teste, se existir. */
function loadRootEnv() {
  if (process.env.NODE_ENV === 'production') return;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate) && existsSync(resolve(dir, 'pnpm-workspace.yaml'))) {
      process.loadEnvFile(candidate);
      return;
    }
    dir = resolve(dir, '..');
  }
}
loadRootEnv();

const bool = z
  .enum(['0', '1', 'true', 'false'])
  .default('0')
  .transform((v) => v === '1' || v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(3333),
  WEB_ORIGIN: z
    .string()
    .default('http://localhost:5173')
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:5173'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379/0'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET precisa ter pelo menos 32 caracteres.'),
  ADMIN_SESSION_TTL_HOURS: z.coerce.number().positive().default(12),
  PARTICIPANT_TOKEN_TTL_HOURS: z.coerce.number().positive().default(12),
  UPLOAD_DIR: z.string().default('./uploads'),
  UPLOAD_MAX_MB: z.coerce.number().positive().max(20).default(5),
  COOKIE_SECURE: bool.optional(),
  /** Habilita o adapter Redis do Socket.IO (necessário com mais de uma instância). */
  SOCKET_REDIS_ADAPTER: bool,
});

export type Env = z.output<typeof envSchema> & { COOKIE_SECURE: boolean };

export function loadEnv(overrides: Record<string, string | undefined> = {}): Env {
  const parsed = envSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuração inválida:\n${msg}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && env.SESSION_SECRET.startsWith('troque')) {
    throw new Error('Defina SESSION_SECRET com um valor aleatório em produção.');
  }
  return { ...env, COOKIE_SECURE: env.COOKIE_SECURE ?? env.NODE_ENV === 'production' };
}
