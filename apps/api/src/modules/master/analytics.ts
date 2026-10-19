import type { Account, Plan } from '@azhoot/db';
import type { AppContext } from '../../context';
import { getPlans, monthlyValueCents } from '../billing/plans';

const PAID = ['CONFIRMED', 'RECEIVED'] as const;
const CHURN_TYPES = ['CANCEL', 'DELETED'];

/** Data (dia civil em Brasília) como meia-noite UTC — formato das colunas DATE. */
function dayStart(d: Date) {
  return new Date(`${d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })}T00:00:00Z`);
}

export function monthKey(d: Date) {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
}

function monthsBetween(from: Date, to: Date) {
  const keys: string[] = [];
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  while (d < to) {
    keys.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return keys;
}

/** MRR atual: contas pagas, ativas, não isentas e não congeladas. */
export async function currentMrr(ctx: AppContext) {
  const [plans, accounts] = await Promise.all([
    getPlans(ctx),
    ctx.prisma.account.findMany({
      where: {
        planId: { not: 'FREE' },
        billingExempt: false,
        active: true,
        subscriptionStatus: { not: 'FROZEN' },
      },
    }),
  ]);
  const byId = new Map(plans.map((p) => [p.id, p]));
  let mrr = 0;
  const perPlan: Record<string, { accounts: number; mrrCents: number }> = {};
  for (const a of accounts) {
    const plan = byId.get(a.planId);
    if (!plan) continue;
    const v = monthlyValueCents(a, plan);
    mrr += v;
    perPlan[a.planId] ??= { accounts: 0, mrrCents: 0 };
    perPlan[a.planId]!.accounts++;
    perPlan[a.planId]!.mrrCents += v;
  }
  return { mrrCents: mrr, payingAccounts: accounts.length, perPlan };
}

export function accountMrr(account: Account, plan: Plan) {
  return account.planId === 'FREE' || account.subscriptionStatus === 'FROZEN' || !account.active
    ? 0
    : monthlyValueCents(account, plan);
}

export interface AnalyticsResult {
  period: { from: string; to: string; months: number };
  mrrCents: number;
  arrCents: number;
  arpaCents: number | null;
  payingAccounts: number;
  revenueCents: number;
  netRevenueCents: number;
  expensesCents: number;
  marketingCents: number;
  commissionsCents: number;
  profitCents: number;
  roi: number | null;
  roas: number | null;
  cacCents: number | null;
  ltvCents: number | null;
  ltvCacRatio: number | null;
  churnRate: number | null;
  churnedAccounts: number;
  signups: number;
  newPaying: number;
  conversionRate: number | null;
  activeAccounts: number;
  sessions: number;
  participants: number;
  answers: number;
  avgParticipantsPerSession: number | null;
  pendingCents: number;
  overdueCents: number;
  pastDueAccounts: number;
  frozenAccounts: number;
  perPlan: Record<string, { accounts: number; mrrCents: number }>;
  expensesByCategory: Record<string, number>;
  series: {
    month: string;
    revenueCents: number;
    expensesCents: number;
    marketingCents: number;
    signups: number;
    newPaying: number;
    churned: number;
    mrrCents: number;
  }[];
}

/**
 * Métricas gerenciais do período [from, to).
 * - MRR/ARR: posição atual; série mensal reconstruída pelos eventos de assinatura.
 * - Churn: cancelamentos + exclusões de contas pagas ÷ base paga no início, médio por mês.
 * - LTV = ARPA ÷ churn mensal · CAC = marketing ÷ novos pagantes · ROAS = receita dos novos pagantes ÷ marketing
 * - ROI = (receita − despesas − comissões) ÷ (despesas + comissões)
 */
export async function analytics(ctx: AppContext, from: Date, to: Date): Promise<AnalyticsResult> {
  const months = Math.max(1, monthsBetween(from, to).length);
  const [
    mrr,
    paidPayments,
    expenses,
    commissions,
    signups,
    newPayingAccounts,
    churnEvents,
    sessions,
    participants,
    answers,
    open,
    statusCounts,
    mrrEvents,
  ] = await Promise.all([
    currentMrr(ctx),
    ctx.prisma.payment.findMany({
      where: { status: { in: [...PAID] }, paidAt: { gte: from, lt: to } },
    }),
    ctx.prisma.expense.findMany({ where: { date: { gte: dayStart(from), lte: dayStart(to) } } }),
    ctx.prisma.commission.aggregate({
      where: { status: { not: 'CANCELED' }, createdAt: { gte: from, lt: to } },
      _sum: { amountCents: true },
    }),
    ctx.prisma.subscriptionEvent.findMany({
      where: { type: 'SIGNUP', createdAt: { gte: from, lt: to } },
      select: { createdAt: true },
    }),
    ctx.prisma.account.findMany({
      where: { firstPaidAt: { gte: from, lt: to } },
      select: { id: true, firstPaidAt: true },
    }),
    ctx.prisma.subscriptionEvent.findMany({
      where: {
        type: { in: CHURN_TYPES },
        fromPlanId: { not: 'FREE' },
        createdAt: { gte: from, lt: to },
      },
      select: { createdAt: true, fromPlanId: true },
    }),
    ctx.prisma.gameSession.findMany({
      where: { startedAt: { gte: from, lt: to } },
      select: { id: true, accountId: true },
    }),
    ctx.prisma.participant.count({ where: { gameSession: { startedAt: { gte: from, lt: to } } } }),
    ctx.prisma.answer.count({ where: { receivedAt: { gte: from, lt: to } } }),
    ctx.prisma.payment.groupBy({
      by: ['status'],
      where: { status: { in: ['PENDING', 'OVERDUE'] } },
      _sum: { amountCents: true },
    }),
    ctx.prisma.account.groupBy({
      by: ['subscriptionStatus'],
      where: { planId: { not: 'FREE' } },
      _count: true,
    }),
    ctx.prisma.subscriptionEvent.findMany({
      where: { mrrDeltaCents: { not: 0 } },
      select: { createdAt: true, mrrDeltaCents: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  const revenueCents = paidPayments.reduce((a, p) => a + p.amountCents, 0);
  const netRevenueCents = paidPayments.reduce((a, p) => a + (p.netAmountCents ?? p.amountCents), 0);
  const expensesCents = expenses.reduce((a, e) => a + e.amountCents, 0);
  const marketingCents = expenses
    .filter((e) => e.category === 'MARKETING')
    .reduce((a, e) => a + e.amountCents, 0);
  const commissionsCents = commissions._sum.amountCents ?? 0;
  const costs = expensesCents + commissionsCents;
  const profitCents = revenueCents - costs;
  const newIds = new Set(newPayingAccounts.map((a) => a.id));
  const newRevenue = paidPayments
    .filter((p) => p.accountId && newIds.has(p.accountId))
    .reduce((a, p) => a + p.amountCents, 0);
  const churned = churnEvents.length;
  const baseAtStart = Math.max(1, mrr.payingAccounts + churned - newPayingAccounts.length);
  const churnRate = mrr.payingAccounts + churned > 0 ? churned / baseAtStart / months : null;
  const arpaCents = mrr.payingAccounts ? Math.round(mrr.mrrCents / mrr.payingAccounts) : null;
  const cacCents = newPayingAccounts.length
    ? Math.round(marketingCents / newPayingAccounts.length)
    : null;
  const ltvCents = arpaCents != null && churnRate ? Math.round(arpaCents / churnRate) : null;
  const expensesByCategory: Record<string, number> = {};
  for (const e of expenses)
    expensesByCategory[e.category] = (expensesByCategory[e.category] ?? 0) + e.amountCents;

  // Série mensal
  const keys = monthsBetween(from, to);
  const series = keys.map((month) => ({
    month,
    revenueCents: 0,
    expensesCents: 0,
    marketingCents: 0,
    signups: 0,
    newPaying: 0,
    churned: 0,
    mrrCents: 0,
  }));
  const idx = new Map(keys.map((k, i) => [k, i]));
  const at = (d: Date | null) => (d ? idx.get(monthKey(d)) : undefined);
  for (const p of paidPayments) {
    const i = at(p.paidAt);
    if (i != null) series[i]!.revenueCents += p.amountCents;
  }
  for (const e of expenses) {
    const i = idx.get(e.date.toISOString().slice(0, 7));
    if (i == null) continue;
    series[i]!.expensesCents += e.amountCents;
    if (e.category === 'MARKETING') series[i]!.marketingCents += e.amountCents;
  }
  for (const s of signups) {
    const i = at(s.createdAt);
    if (i != null) series[i]!.signups++;
  }
  for (const a of newPayingAccounts) {
    const i = at(a.firstPaidAt);
    if (i != null) series[i]!.newPaying++;
  }
  for (const c of churnEvents) {
    const i = at(c.createdAt);
    if (i != null) series[i]!.churned++;
  }
  // MRR por mês: soma acumulada dos deltas, ancorada no MRR atual
  const totalDelta = mrrEvents.reduce((a, e) => a + e.mrrDeltaCents, 0);
  const offset = mrr.mrrCents - totalDelta;
  for (const [i, k] of keys.entries()) {
    const endOfMonth = new Date(`${k}-01T00:00:00Z`);
    endOfMonth.setUTCMonth(endOfMonth.getUTCMonth() + 1);
    const acc = mrrEvents
      .filter((e) => e.createdAt < endOfMonth)
      .reduce((a, e) => a + e.mrrDeltaCents, 0);
    series[i]!.mrrCents = Math.max(0, offset + acc);
  }

  const activeAccounts = new Set(sessions.map((s) => s.accountId)).size;
  const pastDue = statusCounts.find((s) => s.subscriptionStatus === 'PAST_DUE')?._count ?? 0;
  const frozen = statusCounts.find((s) => s.subscriptionStatus === 'FROZEN')?._count ?? 0;

  return {
    period: { from: from.toISOString(), to: to.toISOString(), months },
    mrrCents: mrr.mrrCents,
    arrCents: mrr.mrrCents * 12,
    arpaCents,
    payingAccounts: mrr.payingAccounts,
    revenueCents,
    netRevenueCents,
    expensesCents,
    marketingCents,
    commissionsCents,
    profitCents,
    roi: costs > 0 ? profitCents / costs : null,
    roas: marketingCents > 0 ? newRevenue / marketingCents : null,
    cacCents,
    ltvCents,
    ltvCacRatio: ltvCents != null && cacCents ? ltvCents / cacCents : null,
    churnRate,
    churnedAccounts: churned,
    signups: signups.length,
    newPaying: newPayingAccounts.length,
    conversionRate: signups.length ? newPayingAccounts.length / signups.length : null,
    activeAccounts,
    sessions: sessions.length,
    participants,
    answers,
    avgParticipantsPerSession: sessions.length ? participants / sessions.length : null,
    pendingCents: open.find((o) => o.status === 'PENDING')?._sum.amountCents ?? 0,
    overdueCents: open.find((o) => o.status === 'OVERDUE')?._sum.amountCents ?? 0,
    pastDueAccounts: pastDue,
    frozenAccounts: frozen,
    perPlan: mrr.perPlan,
    expensesByCategory,
    series,
  };
}
