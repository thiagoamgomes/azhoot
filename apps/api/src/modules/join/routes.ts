import { Router, type Request } from 'express';
import {
  joinSchema,
  pinSchema,
  type JoinResponse,
  type PinLookupResponse,
} from '@azhoot/contracts';
import type { AppContext } from '../../context';
import { AppError } from '../../lib/errors';
import { keys } from '../../lib/redis';
import { rateLimit } from '../../middleware/rateLimit';
import type { GameEngine } from '../game/engine';
import { getVersion } from '../game/versionCache';

const FREE_FAILURES = 5;
const BLOCK_AFTER = 60;

/**
 * Proteção contra descoberta de PIN: falhas por IP geram atraso progressivo e, depois, bloqueio.
 * Acertos não contam — muitos participantes podem compartilhar o mesmo IP (NAT de evento).
 */
async function pinGuard(ctx: AppContext, req: Request, found: boolean) {
  const key = keys.pinFail(req.ip ?? 'unknown');
  if (found) return;
  const failures = await ctx.redis.incr(key);
  if (failures === 1) await ctx.redis.expire(key, 15 * 60);
  ctx.metrics.inc('azhoot_pin_failures_total');
  if (failures > BLOCK_AFTER)
    throw new AppError('RATE_LIMITED', { retryAfterSeconds: await ctx.redis.ttl(key) });
  if (failures > FREE_FAILURES) {
    const delay = Math.min(250 * 2 ** (failures - FREE_FAILURES - 1), 4000);
    await new Promise((r) => setTimeout(r, delay));
  }
}

async function assertNotBlocked(ctx: AppContext, req: Request) {
  const failures = Number((await ctx.redis.get(keys.pinFail(req.ip ?? 'unknown'))) ?? 0);
  if (failures > BLOCK_AFTER) throw new AppError('RATE_LIMITED');
}

export function joinRoutes(ctx: AppContext, engine: GameEngine) {
  const r = Router();

  r.get('/:pin', rateLimit(ctx, 'pin-lookup', 600, 10 * 60), async (req, res) => {
    await assertNotBlocked(ctx, req);
    const pinCheck = pinSchema.safeParse(req.params.pin);
    const s = pinCheck.success
      ? await ctx.prisma.gameSession.findFirst({
          where: { pin: pinCheck.data, status: { notIn: ['FINISHED', 'CANCELLED'] } },
        })
      : null;
    await pinGuard(ctx, req, !!s);
    if (!s) throw new AppError('PIN_INVALID');
    const version = await getVersion(ctx, s.quizVersionId);
    const settings = s.settings as { allowLateJoin?: boolean };
    const body: PinLookupResponse = {
      sessionId: s.id,
      quizTitle: version.title,
      status: s.status,
      acceptingJoins: s.status === 'LOBBY' || settings.allowLateJoin !== false,
    };
    res.json(body);
  });

  r.post(
    '/:pin',
    rateLimit(ctx, 'join-ip', 400, 10 * 60),
    rateLimit(ctx, 'join-pin', 400, 60, (req) => String(req.params.pin)),
    async (req, res) => {
      await assertNotBlocked(ctx, req);
      const pin = pinSchema.safeParse(req.params.pin);
      if (!pin.success) {
        await pinGuard(ctx, req, false);
        throw new AppError('PIN_INVALID');
      }
      const parsed = joinSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('NICKNAME_INVALID', {
          fields: { nickname: parsed.error.issues[0]?.message },
        });
      }
      try {
        const result: JoinResponse = await engine.join(pin.data, parsed.data.nickname);
        res.status(201).json(result);
      } catch (err) {
        if (err instanceof AppError && err.code === 'PIN_INVALID') await pinGuard(ctx, req, false);
        throw err;
      }
    },
  );

  return r;
}
