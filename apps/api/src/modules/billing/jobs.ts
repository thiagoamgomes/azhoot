import type { AppContext } from '../../context';
import { weeklyReportText, notify } from '../notifications/service';
import { runBillingCycle } from './service';

const LOCK_KEY = 'azh:job:billing';

function spParts(d: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(d);
  return {
    weekday: parts.find((p) => p.type === 'weekday')?.value,
    hour: Number(parts.find((p) => p.type === 'hour')?.value),
  };
}

/** Semana ISO (ex.: 2026-W39) usada como chave de idempotência do relatório semanal. */
export function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Relatório semanal: toda segunda-feira a partir das 8h (Brasília), para contas com quizzes na semana anterior. */
export async function runWeeklyReports(ctx: AppContext, now = new Date(), force = false) {
  const { weekday, hour } = spParts(now);
  if (!force && (weekday !== 'Mon' || hour < 8)) return 0;
  const until = new Date(now);
  const since = new Date(now.getTime() - 7 * 86400_000);
  const accounts = await ctx.prisma.gameSession.findMany({
    where: { startedAt: { gte: since, lt: until }, status: 'FINISHED', account: { active: true } },
    distinct: ['accountId'],
    select: { accountId: true },
  });
  let sent = 0;
  for (const { accountId } of accounts) {
    const text = await weeklyReportText(ctx, accountId, since, until);
    if (!text) continue;
    sent += await notify(ctx, accountId, 'weekly_report', {
      refKey: `${isoWeek(since)}`,
      vars: { relatorio: text },
    });
  }
  return sent;
}

/** Agenda a rotina (a cada 15 min) com lock no Redis para rodar em uma única instância. */
export function startBillingJobs(ctx: AppContext) {
  const tick = async () => {
    const ok = await ctx.redis
      .set(LOCK_KEY, String(process.pid), 'PX', 10 * 60_000, 'NX')
      .catch(() => null);
    if (ok !== 'OK') return;
    try {
      const r = await runBillingCycle(ctx);
      const weekly = await runWeeklyReports(ctx);
      if (r.applied || r.notices || r.frozen || weekly)
        ctx.logger.info({ ...r, weekly }, 'rotina de cobrança executada');
    } catch (err) {
      ctx.logger.error({ err }, 'falha na rotina de cobrança');
    } finally {
      await ctx.redis.del(LOCK_KEY).catch(() => undefined);
    }
  };
  const first = setTimeout(() => void tick(), 20_000);
  const timer = setInterval(() => void tick(), 15 * 60_000);
  first.unref();
  timer.unref();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
