import { Router } from 'express';
import type { AppContext } from '../../context';

/** Liveness (processo vivo) separado de readiness (dependências prontas). */
export function healthRoutes(ctx: AppContext) {
  const r = Router();
  r.get('/live', (_req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  });
  r.get('/ready', async (_req, res) => {
    const checks: Record<string, { ok: boolean; ms: number; error?: string }> = {};
    const time = async (name: string, fn: () => Promise<unknown>) => {
      const t = Date.now();
      try {
        await Promise.race([
          fn(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000)),
        ]);
        checks[name] = { ok: true, ms: Date.now() - t };
      } catch (err) {
        checks[name] = { ok: false, ms: Date.now() - t, error: (err as Error).message };
      }
    };
    await Promise.all([
      time('postgres', () => ctx.prisma.$queryRaw`SELECT 1`),
      time('redis', () => ctx.redis.ping()),
    ]);
    const ok = Object.values(checks).every((c) => c.ok);
    res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'not_ready', checks });
  });
  return r;
}
