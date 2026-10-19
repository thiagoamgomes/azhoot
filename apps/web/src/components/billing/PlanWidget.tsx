import { Crown, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@azhoot/ui';
import { useBilling } from '@/lib/billing';

function Meter({ label, used, max }: { label: string; used: number; max: number | null }) {
  const ratio = max == null ? 0 : Math.min(1, used / Math.max(1, max));
  return (
    <div>
      <div className="flex justify-between text-[11px] text-slate-300">
        <span>{label}</span>
        <span className="tabular-nums">
          {max == null ? `${used} · ilimitado` : `${used}/${max}`}
        </span>
      </div>
      {max != null && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
          <div
            className={cn('h-full rounded-full', ratio >= 1 ? 'bg-amber-400' : 'bg-blue-400')}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
      )}
    </div>
  );
}

/** Plano atual + uso + atalho para upgrade, exibido acima de "Recolher". */
export function PlanWidget({ collapsed }: { collapsed: boolean }) {
  const { data } = useBilling();
  if (!data) return null;
  const top = data.plan.id === 'YEARLY';
  if (collapsed) {
    return (
      <Link
        to="/planos"
        title={`Plano ${data.plan.name}`}
        className="mx-auto grid size-11 place-items-center rounded-xl bg-white/10 text-amber-300 hover:bg-white/20"
      >
        {top ? <Crown className="size-5" /> : <Sparkles className="size-5" />}
        <span className="sr-only">Plano {data.plan.name}</span>
      </Link>
    );
  }
  return (
    <div className="grid gap-2.5 rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-wider text-slate-400">Seu plano</p>
          <p className="flex items-center gap-1.5 font-display text-sm font-semibold">
            {top ? (
              <Crown className="size-4 text-amber-300" aria-hidden />
            ) : (
              <Sparkles className="size-4 text-blue-300" aria-hidden />
            )}
            {data.plan.name}
            {data.billingExempt && (
              <span className="rounded bg-white/10 px-1.5 text-[10px] font-medium text-slate-300">
                cortesia
              </span>
            )}
          </p>
        </div>
      </div>
      <Meter label="Quizzes" used={data.usage.quizzes} max={data.plan.effectiveLimits.maxQuizzes} />
      <Meter label="Usuários" used={data.usage.users} max={data.plan.effectiveLimits.maxUsers} />
      <Link
        to="/planos"
        className={cn(
          'flex min-h-9 items-center justify-center rounded-xl text-xs font-semibold transition-colors',
          top
            ? 'bg-white/10 text-white hover:bg-white/20'
            : 'bg-gradient-to-r from-blue-500 to-violet-500 text-white hover:opacity-90',
        )}
      >
        {top ? 'Gerenciar plano' : 'Fazer upgrade'}
      </Link>
    </div>
  );
}
