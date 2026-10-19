import type { RedisClient } from './redis';
import { keys } from './redis';

export interface RateResult {
  allowed: boolean;
  count: number;
  resetSeconds: number;
}

/** Janela fixa em Redis. Atômico via MULTI. */
export async function hit(
  redis: RedisClient,
  bucket: string,
  id: string,
  limit: number,
  windowSeconds: number,
): Promise<RateResult> {
  const key = keys.rate(bucket, id);
  const res = await redis.multi().incr(key).expire(key, windowSeconds, 'NX').ttl(key).exec();
  const count = Number(res?.[0]?.[1] ?? 0);
  const ttl = Number(res?.[2]?.[1] ?? windowSeconds);
  return { allowed: count <= limit, count, resetSeconds: ttl > 0 ? ttl : windowSeconds };
}

/** Consulta o contador sem incrementar (para limites que só contam falhas). */
export async function peek(redis: RedisClient, bucket: string, id: string, limit: number) {
  const key = keys.rate(bucket, id);
  const [count, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);
  const n = Number(count ?? 0);
  return { allowed: n < limit, count: n, resetSeconds: ttl > 0 ? ttl : 0 };
}
