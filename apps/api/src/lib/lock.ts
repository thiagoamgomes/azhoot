import { randomUUID } from 'node:crypto';
import type { RedisClient } from './redis';
import { keys } from './redis';

const RELEASE = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;

/** Lock distribuído curto por chave arbitrária (serializa seções críticas concorrentes). */
export async function withLock<T>(
  redis: RedisClient,
  key: string,
  fn: () => Promise<T>,
  { ttlMs = 5000, waitMs = 3000 } = {},
): Promise<T> {
  const token = randomUUID();
  const deadline = Date.now() + waitMs;
  for (;;) {
    const ok = await redis.set(key, token, 'PX', ttlMs, 'NX');
    if (ok === 'OK') break;
    if (Date.now() > deadline) throw new Error(`Timeout aguardando lock ${key}`);
    await new Promise((r) => setTimeout(r, 15 + Math.random() * 25));
  }
  try {
    return await fn();
  } finally {
    await redis.eval(RELEASE, 1, key, token).catch(() => undefined);
  }
}

/**
 * Lock distribuído curto por sessão (serializa transições concorrentes).
 * A consistência final é garantida pela checagem otimista de `stateVersion` no PostgreSQL.
 */
export function withSessionLock<T>(
  redis: RedisClient,
  sessionId: string,
  fn: () => Promise<T>,
  opts: { ttlMs?: number; waitMs?: number } = {},
): Promise<T> {
  return withLock(redis, keys.lock(sessionId), fn, opts);
}
