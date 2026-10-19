import type { Request, RequestHandler } from 'express';
import type { AppContext } from '../context';
import { AppError } from '../lib/errors';
import { hit } from '../lib/rateLimit';

export function rateLimit(
  ctx: AppContext,
  bucket: string,
  limit: number,
  windowSeconds: number,
  keyFn: (req: Request) => string = (req) => req.ip ?? 'unknown',
): RequestHandler {
  return async (req, res, next) => {
    try {
      const r = await hit(ctx.redis, bucket, keyFn(req), limit, windowSeconds);
      if (!r.allowed) {
        res.setHeader('Retry-After', String(r.resetSeconds));
        ctx.metrics.inc('azhoot_rate_limited_total', { bucket });
        throw new AppError('RATE_LIMITED', { retryAfterSeconds: r.resetSeconds });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
