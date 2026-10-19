import type { Limits, PlanDto, PlanId, PlanWithPrice } from '@azhoot/contracts';
import type { Account, Plan } from '@azhoot/db';
import type { AppContext } from '../../context';

let cache: { at: number; plans: Plan[] } | null = null;

export async function getPlans(ctx: AppContext): Promise<Plan[]> {
  if (cache && Date.now() - cache.at < 5000) return cache.plans;
  const plans = await ctx.prisma.plan.findMany({ orderBy: { sortOrder: 'asc' } });
  cache = { at: Date.now(), plans };
  return plans;
}

export function clearPlanCache() {
  cache = null;
}

export async function getPlan(ctx: AppContext, id: string): Promise<Plan | null> {
  return (await getPlans(ctx)).find((p) => p.id === id) ?? null;
}

type AccountLimitsFields = Pick<
  Account,
  | 'overrideMaxQuizzes'
  | 'overrideUnlimitedQuizzes'
  | 'overrideMaxParticipants'
  | 'overrideMaxUsers'
  | 'overridePriceCents'
  | 'planId'
>;

/** Limites efetivos: override da conta (definido pelo master) ou o global do plano. */
export function effectiveLimits(account: AccountLimitsFields, plan: Plan): Limits {
  return {
    maxQuizzes: account.overrideUnlimitedQuizzes
      ? null
      : (account.overrideMaxQuizzes ?? plan.maxQuizzes),
    maxParticipants: account.overrideMaxParticipants ?? plan.maxParticipants,
    maxUsers: account.overrideMaxUsers ?? plan.maxUsers,
  };
}

/** Preço efetivo: o override só vale para o plano atual da conta. */
export function effectivePrice(account: AccountLimitsFields, plan: Plan): number {
  if (plan.id === 'FREE') return 0;
  return account.planId === plan.id && account.overridePriceCents != null
    ? account.overridePriceCents
    : plan.priceCents;
}

/** Limites que a conta terá no plano alvo (overrides de limite continuam valendo). */
export function limitsFor(account: AccountLimitsFields, plan: Plan): Limits {
  return effectiveLimits(account, plan);
}

/** Valor mensal recorrente (MRR) de uma conta num plano. */
export function monthlyValueCents(
  account: AccountLimitsFields & { billingExempt: boolean },
  plan: Plan,
): number {
  if (account.billingExempt || plan.interval === 'NONE') return 0;
  const price = effectivePrice(account, plan);
  return plan.interval === 'YEARLY' ? Math.round(price / 12) : price;
}

export function toPlanDto(p: Plan): PlanDto {
  return {
    id: p.id as PlanId,
    name: p.name,
    description: p.description,
    priceCents: p.priceCents,
    interval: p.interval,
    maxQuizzes: p.maxQuizzes,
    maxParticipants: p.maxParticipants,
    maxUsers: p.maxUsers,
    features: Array.isArray(p.features) ? (p.features as string[]) : [],
    aiCreditsIncluded: p.aiCreditsIncluded,
    active: p.active,
    sortOrder: p.sortOrder,
  };
}

export function withPrice(account: AccountLimitsFields, p: Plan): PlanWithPrice {
  return {
    ...toPlanDto(p),
    effectivePriceCents: effectivePrice(account, p),
    effectiveLimits: limitsFor(account, p),
  };
}

export function addInterval(date: Date, interval: 'NONE' | 'MONTHLY' | 'YEARLY'): Date {
  const d = new Date(date);
  if (interval === 'MONTHLY') d.setUTCMonth(d.getUTCMonth() + 1);
  else if (interval === 'YEARLY') d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}
