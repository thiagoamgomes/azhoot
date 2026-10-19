import { Plus, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useCredits } from '@/lib/ai';

/** Saldo de créditos de IA + atalho para adicionar, exibido acima do card do plano. */
export function CreditWidget({ collapsed }: { collapsed: boolean }) {
  const { data } = useCredits();
  const balance = data?.balance ?? 0;

  if (collapsed) {
    return (
      <Link
        to="/creditos"
        title={`Créditos de IA: ${balance}`}
        className="relative mx-auto grid size-11 place-items-center rounded-xl bg-white/10 text-violet-200 hover:bg-white/20"
      >
        <Sparkles className="size-5" aria-hidden />
        <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-violet-500 px-1 text-[10px] font-semibold leading-4 text-white">
          {balance > 99 ? '99+' : balance}
        </span>
        <span className="sr-only">Créditos de IA: {balance}</span>
      </Link>
    );
  }

  return (
    <div className="grid gap-2.5 rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="flex items-center gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-violet-500/20 text-violet-200">
          <Sparkles className="size-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-wider text-slate-400">Créditos de IA</p>
          <p className="font-display text-sm font-semibold tabular-nums">
            {balance} <span className="font-normal text-slate-400">disponíveis</span>
          </p>
        </div>
      </div>
      <Link
        to="/creditos"
        className="flex min-h-9 items-center justify-center gap-1.5 rounded-xl bg-white/10 text-xs font-semibold text-white transition-colors hover:bg-white/20"
      >
        <Plus className="size-4" aria-hidden /> Adicionar créditos
      </Link>
    </div>
  );
}
