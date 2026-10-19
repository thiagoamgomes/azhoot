import { useQuery } from '@tanstack/react-query';
import { formatBRL, type BillingOverview, type PlanWithPrice } from '@azhoot/contracts';
import { api } from './api';
import { useAuth } from './auth';

export const BILLING_KEY = ['account', 'billing'] as const;

export function useBilling() {
  const { user } = useAuth();
  return useQuery({
    queryKey: BILLING_KEY,
    queryFn: () => api<BillingOverview>('/account/billing'),
    enabled: !!user,
    staleTime: 30_000,
  });
}

export function priceLabel(p: Pick<PlanWithPrice, 'effectivePriceCents' | 'interval'>) {
  if (p.interval === 'NONE' || p.effectivePriceCents === 0) return 'Grátis';
  return `${formatBRL(p.effectivePriceCents)}/${p.interval === 'YEARLY' ? 'ano' : 'mês'}`;
}

export function limitLabel(n: number | null, unit: string) {
  return n == null ? `${unit.charAt(0).toUpperCase()}${unit.slice(1)} ilimitados` : `${n} ${unit}`;
}

/** Diferenças que o cliente perde ao ir para um plano inferior (texto emocional mas honesto). */
export function lossesBetween(from: PlanWithPrice, to: PlanWithPrice) {
  const out: string[] = [];
  const a = from.effectiveLimits;
  const b = to.effectiveLimits;
  if (a.maxQuizzes == null && b.maxQuizzes != null)
    out.push(`Seus quizzes ilimitados viram só ${b.maxQuizzes}`);
  else if (a.maxQuizzes != null && b.maxQuizzes != null && b.maxQuizzes < a.maxQuizzes)
    out.push(`Espaço para quizzes cai de ${a.maxQuizzes} para ${b.maxQuizzes}`);
  if (b.maxParticipants < a.maxParticipants)
    out.push(
      `Salas com até ${b.maxParticipants} pessoas (hoje cabem ${a.maxParticipants}) — adeus aos grandes eventos`,
    );
  if (b.maxUsers < a.maxUsers)
    out.push(
      b.maxUsers === 1
        ? 'Seu time deixa de ter acesso: só 1 usuário na conta'
        : `Seu time cai de ${a.maxUsers} para ${b.maxUsers} usuários`,
    );
  for (const f of from.features)
    if (!to.features.includes(f) && !/quizzes|pessoas|usu[aá]rio/i.test(f)) out.push(`Sem “${f}”`);
  return out;
}
