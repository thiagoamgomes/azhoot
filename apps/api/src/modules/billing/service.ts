import argon2 from 'argon2';
import {
  PAID_STATUSES,
  PLAN_RANK,
  formatBRL,
  type AuthUser,
  type BillingOverview,
  type PaymentDto,
  type PaymentStatusCode,
  type PlanId,
} from '@azhoot/contracts';
import type { Account, Payment, Plan, Prisma } from '@azhoot/db';
import type { AppContext } from '../../context';
import { AppError } from '../../lib/errors';
import { withLock } from '../../lib/lock';
import { keys } from '../../lib/redis';
import { cancelCommissionForPayment, createCommissionForPayment } from '../affiliate/service';
import { grantCredits, grantPlanCredits } from '../credits/service';
import { fmtDate, notify } from '../notifications/service';
import { getProvider, SimulatedProvider, type ProviderPayment } from './provider';
import {
  addInterval,
  effectiveLimits,
  effectivePrice,
  getPlan,
  getPlans,
  limitsFor,
  monthlyValueCents,
  withPrice,
} from './plans';

export type AccountWithPlan = Account & { plan: Plan };

const OPEN: PaymentStatusCode[] = ['PENDING', 'OVERDUE'];
const DAY = 86_400_000;
/** Dias após o vencimento para congelar a conta. */
export const FREEZE_AFTER_DAYS = 5;

/* ------------------------------------------------------------------------ */
/* Consultas                                                                 */
/* ------------------------------------------------------------------------ */

export async function loadAccount(ctx: AppContext, accountId: string): Promise<AccountWithPlan> {
  const a = await ctx.prisma.account.findUnique({
    where: { id: accountId },
    include: { plan: true },
  });
  if (!a) throw new AppError('NOT_FOUND');
  return a;
}

/** Uso que conta para os limites: quizzes não arquivados e usuários ativos. */
export async function usage(ctx: AppContext, accountId: string) {
  const [quizzes, users] = await Promise.all([
    ctx.prisma.quiz.count({ where: { accountId, status: { not: 'ARCHIVED' } } }),
    ctx.prisma.user.count({ where: { accountId, active: true } }),
  ]);
  return { quizzes, users };
}

export function toPaymentDto(p: Payment): PaymentDto {
  return {
    id: p.id,
    accountId: p.accountId,
    accountName: p.accountName,
    planId: p.planId,
    amountCents: p.amountCents,
    status: p.status,
    billingType: p.billingType,
    description: p.description,
    dueDate: p.dueDate.toISOString(),
    paidAt: p.paidAt?.toISOString() ?? null,
    invoiceUrl: p.invoiceUrl,
    periodStart: p.periodStart?.toISOString() ?? null,
    periodEnd: p.periodEnd?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

/** Dias corridos entre duas datas no fuso de Brasília (b - a). */
export function daysBetween(a: Date, b: Date) {
  const day = (d: Date) => {
    const s = d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    return Date.parse(`${s}T00:00:00Z`);
  };
  return Math.round((day(b) - day(a)) / DAY);
}

async function openRenewalPayment(ctx: AppContext, account: Account) {
  return ctx.prisma.payment.findFirst({
    where: { accountId: account.id, planId: account.planId, status: { in: OPEN } },
    orderBy: { dueDate: 'asc' },
  });
}

async function openCheckoutPayment(ctx: AppContext, account: Account) {
  const p = await ctx.prisma.payment.findFirst({
    where: { accountId: account.id, planId: { not: account.planId }, status: { in: OPEN } },
    orderBy: { createdAt: 'desc' },
  });
  if (!p) return null;
  return PLAN_RANK[p.planId as PlanId] > PLAN_RANK[account.planId as PlanId] ? p : null;
}

export async function getOverview(
  ctx: AppContext,
  account: AccountWithPlan,
  user: AuthUser,
): Promise<BillingOverview> {
  const [plans, use, open, checkout] = await Promise.all([
    getPlans(ctx),
    usage(ctx, account.id),
    openRenewalPayment(ctx, account),
    openCheckoutPayment(ctx, account),
  ]);
  const removals = (account.pendingRemovals ?? {}) as { quizIds?: string[]; userIds?: string[] };
  return {
    accountId: account.id,
    accountName: account.name,
    isOwner: user.role === 'OWNER',
    plan: withPrice(account, account.plan),
    usage: use,
    subscriptionStatus: account.subscriptionStatus,
    billingExempt: account.billingExempt,
    currentPeriodEnd: account.currentPeriodEnd?.toISOString() ?? null,
    pendingPlanId: (account.pendingPlanId as PlanId | null) ?? null,
    pendingChangeAt: account.pendingChangeAt?.toISOString() ?? null,
    pendingRemovals: { quizIds: removals.quizIds ?? [], userIds: removals.userIds ?? [] },
    openPayment: open ? toPaymentDto(open) : null,
    checkoutPayment: checkout ? toPaymentDto(checkout) : null,
    plans: plans
      .filter((p) => p.active || p.id === account.planId)
      .map((p) => withPrice(account, p)),
    billing: {
      name: account.billingName,
      document: account.billingDocument,
      email: account.billingEmail,
      phone: account.billingPhone,
    },
    affiliateEnabled: account.affiliateEnabled,
    daysOverdue:
      open && daysBetween(open.dueDate, new Date()) > 0
        ? daysBetween(open.dueDate, new Date())
        : null,
  };
}

/* ------------------------------------------------------------------------ */
/* Limites                                                                   */
/* ------------------------------------------------------------------------ */

export async function assertCanCreateQuiz(ctx: AppContext, account: AccountWithPlan) {
  assertNotFrozen(account);
  const { maxQuizzes } = effectiveLimits(account, account.plan);
  if (maxQuizzes == null) return;
  const { quizzes } = await usage(ctx, account.id);
  if (quizzes >= maxQuizzes)
    throw new AppError('PLAN_LIMIT_QUIZZES', { limit: maxQuizzes, used: quizzes });
}

export async function assertCanAddUser(ctx: AppContext, account: AccountWithPlan) {
  assertNotFrozen(account);
  const { maxUsers } = effectiveLimits(account, account.plan);
  const { users } = await usage(ctx, account.id);
  if (users >= maxUsers) throw new AppError('PLAN_LIMIT_USERS', { limit: maxUsers, used: users });
}

/**
 * V10: verifica o limite e cria dentro do mesmo lock por conta, evitando a corrida
 * "contar-depois-criar" (duas criações concorrentes ultrapassarem o teto do plano).
 */
export function createQuizWithinLimit<T>(
  ctx: AppContext,
  account: AccountWithPlan,
  create: () => Promise<T>,
): Promise<T> {
  return withLock(ctx.redis, keys.accountLock(account.id), async () => {
    await assertCanCreateQuiz(ctx, account);
    return create();
  });
}

export function addUserWithinLimit<T>(
  ctx: AppContext,
  account: AccountWithPlan,
  create: () => Promise<T>,
): Promise<T> {
  return withLock(ctx.redis, keys.accountLock(account.id), async () => {
    await assertCanAddUser(ctx, account);
    return create();
  });
}

export function maxParticipantsFor(account: AccountWithPlan) {
  return effectiveLimits(account, account.plan).maxParticipants;
}

export function assertNotFrozen(account: Account) {
  if (account.subscriptionStatus === 'FROZEN') throw new AppError('ACCOUNT_FROZEN');
}

/**
 * Verifica se a seleção de exclusões faz a conta caber no plano alvo.
 * Retorna quantos itens ainda faltam remover (0 = ok).
 */
export async function removalShortfall(
  ctx: AppContext,
  account: AccountWithPlan,
  target: Plan,
  removals: { removeQuizIds: string[]; removeUserIds: string[] },
) {
  const limits = limitsFor(account, target);
  const [quizIds, users] = await Promise.all([
    ctx.prisma.quiz.findMany({
      where: { accountId: account.id, status: { not: 'ARCHIVED' } },
      select: { id: true },
    }),
    ctx.prisma.user.findMany({
      where: { accountId: account.id, active: true },
      select: { id: true, role: true },
    }),
  ]);
  const validQuiz = new Set(quizIds.map((q) => q.id));
  const removableUsers = new Set(users.filter((u) => u.role !== 'OWNER').map((u) => u.id));
  const rq = new Set(removals.removeQuizIds.filter((id) => validQuiz.has(id)));
  const ru = new Set(removals.removeUserIds.filter((id) => removableUsers.has(id)));
  const quizzesAfter = quizIds.length - rq.size;
  const usersAfter = users.length - ru.size;
  return {
    quizzes: limits.maxQuizzes == null ? 0 : Math.max(0, quizzesAfter - limits.maxQuizzes),
    users: Math.max(0, usersAfter - limits.maxUsers),
    quizIds: [...rq],
    userIds: [...ru],
    limits,
    current: { quizzes: quizIds.length, users: users.length },
  };
}

/** Exclui quizzes e usuários selecionados; excedentes restantes são arquivados/desativados (nunca excluídos sem escolha). */
async function applyRemovals(
  tx: Prisma.TransactionClient,
  account: Account,
  target: Plan,
  removals: { quizIds: string[]; userIds: string[] },
) {
  const owner = await tx.user.findFirst({
    where: { accountId: account.id, role: 'OWNER' },
    orderBy: { createdAt: 'asc' },
  });
  if (removals.quizIds.length)
    await tx.quiz.deleteMany({ where: { accountId: account.id, id: { in: removals.quizIds } } });
  for (const userId of removals.userIds) {
    const u = await tx.user.findFirst({ where: { id: userId, accountId: account.id } });
    if (!u || u.role === 'OWNER' || !owner) continue;
    await tx.quiz.updateMany({ where: { ownerId: u.id }, data: { ownerId: owner.id } });
    await tx.gameSession.updateMany({
      where: { hostUserId: u.id },
      data: { hostUserId: owner.id },
    });
    await tx.user.delete({ where: { id: u.id } });
  }
  const limits = limitsFor(account, target);
  if (limits.maxQuizzes != null) {
    const extra = await tx.quiz.findMany({
      where: { accountId: account.id, status: { not: 'ARCHIVED' } },
      orderBy: { createdAt: 'desc' },
      skip: limits.maxQuizzes,
      select: { id: true },
    });
    if (extra.length)
      await tx.quiz.updateMany({
        where: { id: { in: extra.map((q) => q.id) } },
        data: { status: 'ARCHIVED', archivedAt: new Date() },
      });
  }
  const extraUsers = await tx.user.findMany({
    where: { accountId: account.id, active: true, role: { not: 'OWNER' } },
    orderBy: { createdAt: 'desc' },
    skip: Math.max(0, limits.maxUsers - 1),
    select: { id: true },
  });
  if (extraUsers.length) {
    await tx.user.updateMany({
      where: { id: { in: extraUsers.map((u) => u.id) } },
      data: { active: false },
    });
    await tx.adminSession.deleteMany({ where: { userId: { in: extraUsers.map((u) => u.id) } } });
  }
}

/* ------------------------------------------------------------------------ */
/* Checkout / upgrade                                                        */
/* ------------------------------------------------------------------------ */

async function storeProviderPayments(
  ctx: AppContext,
  account: Account,
  plan: Plan,
  providerName: string,
  payments: ProviderPayment[],
) {
  const saved: Payment[] = [];
  for (const pp of payments) {
    saved.push(
      await ctx.prisma.payment.upsert({
        where: { providerId: pp.id },
        create: {
          accountId: account.id,
          accountName: account.name,
          planId: plan.id,
          amountCents: pp.valueCents,
          netAmountCents: pp.netValueCents,
          status: pp.status,
          billingType: pp.billingType,
          description: `AZhoot — Plano ${plan.name}`,
          dueDate: pp.dueDate,
          paidAt: pp.paidAt,
          periodStart: pp.dueDate,
          periodEnd: addInterval(pp.dueDate, plan.interval),
          invoiceUrl: pp.invoiceUrl,
          provider: providerName,
          providerId: pp.id,
          providerSubscriptionId: pp.subscriptionId,
        },
        update: {},
      }),
    );
  }
  return saved;
}

export interface CheckoutInputResolved {
  planId: 'MONTHLY' | 'YEARLY';
  billingName: string;
  billingDocument: string;
  billingEmail?: string;
  billingPhone?: string;
}

/**
 * Upgrade (Gratuito → pago ou Mensal → Anual): cria a assinatura no Asaas e devolve a fatura.
 * O plano só muda quando o primeiro pagamento é confirmado (webhook).
 */
export async function checkout(
  ctx: AppContext,
  accountArg: AccountWithPlan,
  input: CheckoutInputResolved,
  user: AuthUser,
) {
  // V9: serializa o checkout por conta e revalida o estado sob o lock,
  // evitando criar duas assinaturas em requisições concorrentes.
  return withLock(
    ctx.redis,
    keys.accountLock(accountArg.id),
    () => checkoutLocked(ctx, accountArg, input, user),
    { ttlMs: 20_000, waitMs: 8000 },
  );
}

async function checkoutLocked(
  ctx: AppContext,
  accountArg: AccountWithPlan,
  input: CheckoutInputResolved,
  user: AuthUser,
) {
  const account = await loadAccount(ctx, accountArg.id); // estado fresco sob o lock
  const target = await getPlan(ctx, input.planId);
  if (!target || !target.active || target.interval === 'NONE') throw new AppError('PLAN_INVALID');
  const sameAsCurrent = target.id === account.planId;
  if (sameAsCurrent) {
    // Mesmo plano: só faz sentido para regularizar uma fatura em aberto.
    const open = await openRenewalPayment(ctx, account);
    if (open) return { payment: toPaymentDto(open), invoiceUrl: open.invoiceUrl };
    throw new AppError('PLAN_SAME');
  }
  if (PLAN_RANK[target.id as PlanId] < PLAN_RANK[account.planId as PlanId])
    throw new AppError('PLAN_INVALID', { hint: 'downgrade' });

  if (account.billingExempt) {
    await applyPlanNow(ctx, account, target, { quizIds: [], userIds: [] }, 'UPGRADE');
    return { payment: null, invoiceUrl: null };
  }

  const pending = await openCheckoutPayment(ctx, account);
  if (pending && pending.planId === target.id)
    return { payment: toPaymentDto(pending), invoiceUrl: pending.invoiceUrl };

  const provider = await getProvider(ctx);
  const email = input.billingEmail ?? user.email;
  let customerId = account.asaasCustomerId;
  const docChanged = account.billingDocument !== input.billingDocument;
  if (!customerId || docChanged || (provider.name === 'asaas') !== !customerId.startsWith('sim_')) {
    customerId = await provider.createCustomer({
      name: input.billingName,
      document: input.billingDocument,
      email,
      phone: input.billingPhone,
      externalReference: account.id,
    });
  }
  // Checkout anterior para outro plano: cancela a assinatura não paga.
  if (pending?.providerSubscriptionId) {
    await provider.cancelSubscription(pending.providerSubscriptionId).catch(() => undefined);
    await ctx.prisma.payment.updateMany({
      where: { providerSubscriptionId: pending.providerSubscriptionId, status: { in: OPEN } },
      data: { status: 'CANCELED' },
    });
  }
  const valueCents = target.priceCents;
  const sub = await provider.createSubscription({
    customerId,
    valueCents,
    cycle: target.interval as 'MONTHLY' | 'YEARLY',
    nextDueDate: new Date(),
    description: `AZhoot — Plano ${target.name}`,
    externalReference: account.id,
  });
  const updated = await ctx.prisma.account.update({
    where: { id: account.id },
    data: {
      asaasCustomerId: customerId,
      billingName: input.billingName,
      billingDocument: input.billingDocument,
      billingEmail: email,
      billingPhone: input.billingPhone || null,
      // Upgrade desfaz qualquer downgrade/cancelamento agendado
      pendingPlanId: null,
      pendingChangeAt: null,
      pendingRemovals: {},
    },
  });
  const saved = await storeProviderPayments(ctx, updated, target, provider.name, sub.payments);
  const first = saved[0] ?? null;
  ctx.logger.info({ accountId: account.id, planId: target.id }, 'checkout criado');
  return { payment: first ? toPaymentDto(first) : null, invoiceUrl: first?.invoiceUrl ?? null };
}

/* ------------------------------------------------------------------------ */
/* Eventos de pagamento (webhook Asaas / simulado)                           */
/* ------------------------------------------------------------------------ */

async function logEvent(
  tx: Prisma.TransactionClient | AppContext['prisma'],
  accountId: string | null,
  type: string,
  fromPlanId: string | null,
  toPlanId: string | null,
  mrrDeltaCents = 0,
) {
  await tx.subscriptionEvent.create({
    data: { accountId, type, fromPlanId, toPlanId, mrrDeltaCents },
  });
}

/** Processa um pagamento vindo do provedor. Idempotente. */
export async function handleProviderPayment(
  ctx: AppContext,
  pp: ProviderPayment,
  providerName = 'asaas',
) {
  let payment = await ctx.prisma.payment.findUnique({ where: { providerId: pp.id } });
  let created = false;
  if (!payment) {
    created = true;
    // Renovação criada pelo provedor: herda conta e plano da assinatura.
    const sibling = pp.subscriptionId
      ? await ctx.prisma.payment.findFirst({
          where: { providerSubscriptionId: pp.subscriptionId },
          orderBy: { createdAt: 'asc' },
        })
      : null;
    const account = sibling?.accountId
      ? await ctx.prisma.account.findUnique({
          where: { id: sibling.accountId },
          include: { plan: true },
        })
      : pp.subscriptionId
        ? await ctx.prisma.account.findUnique({
            where: { asaasSubscriptionId: pp.subscriptionId },
            include: { plan: true },
          })
        : null;
    if (!account) {
      ctx.logger.warn({ providerId: pp.id }, 'pagamento sem conta correspondente ignorado');
      return null;
    }
    const plan = (await getPlan(ctx, sibling?.planId ?? account.planId))!;
    payment = (
      await storeProviderPayments(ctx, account, plan, providerName, [
        { ...pp, status: 'PENDING', paidAt: null },
      ])
    )[0]!;
  }
  const wasPaid = !created && PAID_STATUSES.includes(payment.status);
  payment = await ctx.prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: wasPaid && pp.status === 'PENDING' ? payment.status : pp.status,
      // V1: não sobrescreve o valor cobrado de um pagamento já conhecido com o valor
      // vindo do provedor/webhook; só define o valor ao criar o registro.
      ...(created ? { amountCents: pp.valueCents } : {}),
      netAmountCents: pp.netValueCents ?? payment.netAmountCents,
      dueDate: pp.dueDate,
      paidAt: pp.paidAt ?? payment.paidAt,
      invoiceUrl: pp.invoiceUrl ?? payment.invoiceUrl,
      billingType: pp.billingType ?? payment.billingType,
      periodStart: payment.periodStart ?? pp.dueDate,
    },
  });
  const nowPaid = PAID_STATUSES.includes(payment.status);
  if (!payment.accountId) return payment;

  if (nowPaid && !wasPaid) {
    if (payment.kind === 'CREDIT_PACK') await onCreditPackPaid(ctx, payment);
    else await onPaymentPaid(ctx, payment);
  } else if (payment.status === 'OVERDUE') await onPaymentOverdue(ctx, payment);
  else if (payment.status === 'REFUNDED' || payment.status === 'CANCELED')
    await cancelCommissionForPayment(ctx, payment.id);
  return payment;
}

/** Pagamento de pacote de créditos confirmado: credita a conta (idempotente). */
async function onCreditPackPaid(ctx: AppContext, payment: Payment) {
  if (!payment.accountId || !payment.creditsGranted) return;
  await grantCredits(ctx, payment.accountId, payment.creditsGranted, 'PURCHASE', {
    refKey: payment.id,
    note: `Compra de ${payment.creditsGranted} créditos`,
  });
  ctx.metrics.inc('azhoot_credit_packs_paid_total');
}

async function onPaymentPaid(ctx: AppContext, payment: Payment) {
  const account = await loadAccount(ctx, payment.accountId!);
  const plan = (await getPlan(ctx, payment.planId))!;
  const periodEnd = payment.periodEnd ?? addInterval(payment.dueDate, plan.interval);
  const now = new Date();
  if (account.planId !== plan.id) {
    // Upgrade confirmado
    const oldPlan = account.plan;
    const oldSub = account.asaasSubscriptionId;
    await ctx.prisma.$transaction(async (tx) => {
      await tx.account.update({
        where: { id: account.id },
        data: {
          planId: plan.id,
          asaasSubscriptionId: payment.providerSubscriptionId,
          subscriptionStatus: 'ACTIVE',
          frozenAt: null,
          currentPeriodStart: payment.periodStart ?? payment.dueDate,
          currentPeriodEnd: periodEnd,
          pendingPlanId: null,
          pendingChangeAt: null,
          pendingRemovals: {},
          firstPaidAt: account.firstPaidAt ?? now,
          canceledAt: null,
          overridePriceCents: null,
        },
      });
      const delta =
        monthlyValueCents({ ...account, planId: plan.id, overridePriceCents: null }, plan) -
        monthlyValueCents(account, oldPlan);
      await logEvent(tx, account.id, 'UPGRADE', oldPlan.id, plan.id, delta);
    });
    if (oldSub && oldSub !== payment.providerSubscriptionId) {
      const provider = await getProvider(ctx).catch(() => null);
      await provider
        ?.cancelSubscription(oldSub)
        .catch((err) => ctx.logger.warn({ err }, 'falha ao cancelar assinatura anterior'));
      await ctx.prisma.payment.updateMany({
        where: { providerSubscriptionId: oldSub, status: { in: OPEN } },
        data: { status: 'CANCELED' },
      });
    }
    // Créditos de IA incluídos no plano, concedidos uma vez por contratação.
    await grantPlanCredits(ctx, account.id, plan.id, plan.aiCreditsIncluded, payment.id);
    await notify(ctx, account.id, 'plan_contracted', {
      refKey: payment.id,
      vars: {
        plano: plan.name,
        valor: formatBRL(payment.amountCents),
        vencimento: fmtDate(periodEnd),
      },
    });
  } else {
    // Renovação / regularização
    const wasFrozen = account.subscriptionStatus === 'FROZEN';
    await ctx.prisma.account.update({
      where: { id: account.id },
      data: {
        subscriptionStatus: 'ACTIVE',
        frozenAt: null,
        currentPeriodStart: payment.periodStart ?? payment.dueDate,
        currentPeriodEnd:
          account.currentPeriodEnd && account.currentPeriodEnd > periodEnd
            ? account.currentPeriodEnd
            : periodEnd,
        firstPaidAt: account.firstPaidAt ?? now,
      },
    });
    await logEvent(
      ctx.prisma,
      account.id,
      wasFrozen ? 'UNFROZEN' : 'RENEW',
      plan.id,
      plan.id,
      wasFrozen ? monthlyValueCents(account, plan) : 0,
    );
  }
  await createCommissionForPayment(ctx, payment);
  ctx.metrics.inc('azhoot_payments_paid_total', { plan: plan.id });
}

async function onPaymentOverdue(ctx: AppContext, payment: Payment) {
  const account = await loadAccount(ctx, payment.accountId!);
  if (
    account.planId === payment.planId &&
    account.subscriptionStatus === 'ACTIVE' &&
    !account.billingExempt
  ) {
    await ctx.prisma.account.update({
      where: { id: account.id },
      data: { subscriptionStatus: 'PAST_DUE' },
    });
  }
}

/* ------------------------------------------------------------------------ */
/* Downgrade / cancelamento                                                  */
/* ------------------------------------------------------------------------ */

/** Aplica imediatamente um plano (cortesia, downgrade agendado, cancelamento de conta congelada). */
export async function applyPlanNow(
  ctx: AppContext,
  account: AccountWithPlan,
  target: Plan,
  removals: { quizIds: string[]; userIds: string[] },
  type: 'UPGRADE' | 'DOWNGRADE' | 'CANCEL' | 'MASTER',
) {
  const provider = target.id === 'FREE' || account.billingExempt ? null : await getProvider(ctx);
  const oldPlan = account.plan;
  // Assinatura antiga não gera mais cobranças
  if (account.asaasSubscriptionId) {
    const p = await getProvider(ctx).catch(() => null);
    await p
      ?.cancelSubscription(account.asaasSubscriptionId)
      .catch((err) => ctx.logger.warn({ err }, 'falha ao cancelar assinatura'));
    await ctx.prisma.payment.updateMany({
      where: { providerSubscriptionId: account.asaasSubscriptionId, status: { in: OPEN } },
      data: { status: 'CANCELED' },
    });
  }
  let subscriptionId: string | null = null;
  let newPayments: ProviderPayment[] = [];
  const now = new Date();
  if (provider && target.interval !== 'NONE' && account.asaasCustomerId) {
    const sub = await provider.createSubscription({
      customerId: account.asaasCustomerId,
      valueCents: target.priceCents,
      cycle: target.interval as 'MONTHLY' | 'YEARLY',
      nextDueDate: now,
      description: `AZhoot — Plano ${target.name}`,
      externalReference: account.id,
    });
    subscriptionId = sub.subscriptionId;
    newPayments = sub.payments;
  }
  await ctx.prisma.$transaction(async (tx) => {
    await applyRemovals(tx, account, target, removals);
    await tx.account.update({
      where: { id: account.id },
      data: {
        planId: target.id,
        asaasSubscriptionId: subscriptionId,
        subscriptionStatus: 'ACTIVE',
        frozenAt: null,
        pendingPlanId: null,
        pendingChangeAt: null,
        pendingRemovals: {},
        overridePriceCents: null,
        currentPeriodStart: target.interval === 'NONE' || account.billingExempt ? null : now,
        currentPeriodEnd: target.interval === 'NONE' || account.billingExempt ? null : now,
        canceledAt: target.id === 'FREE' ? now : account.canceledAt,
      },
    });
    const delta =
      monthlyValueCents({ ...account, planId: target.id, overridePriceCents: null }, target) -
      monthlyValueCents(account, oldPlan);
    await logEvent(tx, account.id, type, oldPlan.id, target.id, delta);
  });
  if (newPayments.length)
    await storeProviderPayments(ctx, account, target, provider!.name, newPayments);
  if (oldPlan.id !== target.id) {
    // Cortesia/ajuste do master ou upgrade imediato: concede os créditos do plano alvo.
    if (type === 'UPGRADE' || type === 'MASTER')
      await grantPlanCredits(
        ctx,
        account.id,
        target.id,
        target.aiCreditsIncluded,
        now.toISOString(),
      );
    await notify(ctx, account.id, 'plan_changed', {
      refKey: `${account.id}:${now.toISOString()}`,
      vars: { plano: target.name, plano_anterior: oldPlan.name },
    });
  }
}

/**
 * Downgrade ou cancelamento: agenda para o fim do período pago, com a seleção do que excluir.
 * O cancelamento para de gerar cobranças imediatamente.
 */
export async function scheduleChange(
  ctx: AppContext,
  account: AccountWithPlan,
  targetId: PlanId,
  input: { removeQuizIds: string[]; removeUserIds: string[] },
) {
  const target = await getPlan(ctx, targetId);
  if (!target || (!target.active && target.id !== 'FREE')) throw new AppError('PLAN_INVALID');
  if (target.id === account.planId) throw new AppError('PLAN_SAME');
  if (PLAN_RANK[target.id as PlanId] > PLAN_RANK[account.planId as PlanId])
    throw new AppError('PLAN_INVALID', { hint: 'upgrade' });
  const check = await removalShortfall(ctx, account, target, input);
  if (check.quizzes > 0 || check.users > 0) {
    throw new AppError('PLAN_REMOVALS_REQUIRED', {
      quizzes: check.quizzes,
      users: check.users,
      limits: check.limits,
    });
  }
  const removals = { quizIds: check.quizIds, userIds: check.userIds };
  const immediate =
    account.billingExempt ||
    account.subscriptionStatus === 'FROZEN' ||
    !account.currentPeriodEnd ||
    account.currentPeriodEnd <= new Date();
  if (immediate) {
    await applyPlanNow(
      ctx,
      account,
      target,
      removals,
      target.id === 'FREE' ? 'CANCEL' : 'DOWNGRADE',
    );
    return { scheduled: false, effectiveAt: new Date().toISOString() };
  }
  // Para as cobranças do plano atual; o novo plano (se pago) é criado na data da mudança.
  if (account.asaasSubscriptionId) {
    const provider = await getProvider(ctx);
    await provider.cancelSubscription(account.asaasSubscriptionId).catch((err) => {
      ctx.logger.warn({ err }, 'falha ao cancelar assinatura no provedor');
      throw new AppError('BILLING_PROVIDER_ERROR');
    });
    await ctx.prisma.payment.updateMany({
      where: {
        providerSubscriptionId: account.asaasSubscriptionId,
        status: { in: OPEN },
        dueDate: { gte: account.currentPeriodEnd! },
      },
      data: { status: 'CANCELED' },
    });
  }
  await ctx.prisma.account.update({
    where: { id: account.id },
    data: {
      pendingPlanId: target.id,
      pendingChangeAt: account.currentPeriodEnd,
      pendingRemovals: removals,
      asaasSubscriptionId: null,
    },
  });
  await logEvent(
    ctx.prisma,
    account.id,
    target.id === 'FREE' ? 'CANCEL_SCHEDULED' : 'DOWNGRADE_SCHEDULED',
    account.planId,
    target.id,
  );
  return { scheduled: true, effectiveAt: account.currentPeriodEnd!.toISOString() };
}

/** Desfaz um downgrade/cancelamento agendado, retomando as cobranças do plano atual. */
export async function revertScheduledChange(ctx: AppContext, account: AccountWithPlan) {
  if (!account.pendingPlanId) throw new AppError('NO_PENDING_CHANGE');
  let subscriptionId: string | null = null;
  if (
    !account.billingExempt &&
    account.plan.interval !== 'NONE' &&
    account.asaasCustomerId &&
    account.currentPeriodEnd
  ) {
    const provider = await getProvider(ctx);
    const sub = await provider.createSubscription({
      customerId: account.asaasCustomerId,
      valueCents: effectivePrice(account, account.plan),
      cycle: account.plan.interval as 'MONTHLY' | 'YEARLY',
      nextDueDate: account.currentPeriodEnd,
      description: `AZhoot — Plano ${account.plan.name}`,
      externalReference: account.id,
    });
    subscriptionId = sub.subscriptionId;
    await storeProviderPayments(ctx, account, account.plan, provider.name, sub.payments);
  }
  await ctx.prisma.account.update({
    where: { id: account.id },
    data: {
      pendingPlanId: null,
      pendingChangeAt: null,
      pendingRemovals: {},
      asaasSubscriptionId: subscriptionId,
    },
  });
  await logEvent(ctx.prisma, account.id, 'CHANGE_REVERTED', account.pendingPlanId, account.planId);
}

/* ------------------------------------------------------------------------ */
/* Rotina diária: mudanças agendadas, renovações simuladas e inadimplência   */
/* ------------------------------------------------------------------------ */

export async function runBillingCycle(ctx: AppContext, now = new Date()) {
  const result = { applied: 0, renewals: 0, notices: 0, frozen: 0 };

  // 1. Mudanças agendadas vencidas
  const due = await ctx.prisma.account.findMany({
    where: { pendingPlanId: { not: null }, pendingChangeAt: { lte: now } },
    include: { plan: true },
  });
  for (const account of due) {
    const target = await getPlan(ctx, account.pendingPlanId!);
    if (!target) continue;
    const removals = account.pendingRemovals as { quizIds?: string[]; userIds?: string[] };
    try {
      await applyPlanNow(
        ctx,
        account,
        target,
        { quizIds: removals.quizIds ?? [], userIds: removals.userIds ?? [] },
        target.id === 'FREE' ? 'CANCEL' : 'DOWNGRADE',
      );
      result.applied++;
    } catch (err) {
      ctx.logger.error({ err, accountId: account.id }, 'falha ao aplicar mudança agendada');
    }
  }

  // 2. Renovações do provedor simulado (o Asaas cria as cobranças sozinho)
  const simAccounts = await ctx.prisma.account.findMany({
    where: {
      asaasSubscriptionId: { startsWith: 'sim_' },
      currentPeriodEnd: { lte: new Date(now.getTime() + 10 * DAY) },
      pendingPlanId: null,
    },
    include: { plan: true },
  });
  for (const account of simAccounts) {
    const exists = await ctx.prisma.payment.findFirst({
      where: {
        providerSubscriptionId: account.asaasSubscriptionId,
        dueDate: { gte: new Date(account.currentPeriodEnd!.getTime() - DAY) },
      },
    });
    if (exists) continue;
    const sim = new SimulatedProvider(ctx.env.PUBLIC_WEB_URL);
    const sub = await sim.createSubscription({
      customerId: account.asaasCustomerId ?? '',
      valueCents: effectivePrice(account, account.plan),
      cycle: account.plan.interval as 'MONTHLY' | 'YEARLY',
      nextDueDate: account.currentPeriodEnd!,
      description: `AZhoot — Plano ${account.plan.name}`,
      externalReference: account.id,
    });
    await storeProviderPayments(
      ctx,
      account,
      account.plan,
      'simulated',
      sub.payments.map((p) => ({ ...p, subscriptionId: account.asaasSubscriptionId })),
    );
    result.renewals++;
  }

  // 3. Cobrança: lembretes, atraso e congelamento
  const open = await ctx.prisma.payment.findMany({
    where: {
      status: { in: OPEN },
      accountId: { not: null },
      dueDate: { lte: new Date(now.getTime() + 6 * DAY) },
    },
    include: { account: { include: { plan: true } } },
  });
  for (const payment of open) {
    const account = payment.account;
    if (
      !account ||
      account.billingExempt ||
      account.planId !== payment.planId ||
      account.planId === 'FREE'
    )
      continue;
    const days = daysBetween(payment.dueDate, now); // negativo = antes do vencimento
    const vars = {
      valor: formatBRL(payment.amountCents),
      vencimento: fmtDate(payment.dueDate),
      plano: account.plan.name,
    };
    const link = '/planos';
    if (days >= -5 && days <= -1) {
      result.notices += await notify(ctx, account.id, 'due_soon', {
        refKey: payment.id,
        vars,
        link,
      });
    }
    if (days === 0) {
      result.notices += await notify(ctx, account.id, 'due_today', {
        refKey: payment.id,
        vars,
        link,
      });
    }
    if (days >= 1) {
      if (payment.status === 'PENDING')
        await ctx.prisma.payment.update({ where: { id: payment.id }, data: { status: 'OVERDUE' } });
      if (account.subscriptionStatus === 'ACTIVE') {
        await ctx.prisma.account.update({
          where: { id: account.id },
          data: { subscriptionStatus: 'PAST_DUE' },
        });
      }
      if (days < FREEZE_AFTER_DAYS)
        result.notices += await notify(ctx, account.id, 'overdue_1', {
          refKey: payment.id,
          vars,
          link,
        });
    }
    if (days >= FREEZE_AFTER_DAYS && account.subscriptionStatus !== 'FROZEN') {
      await ctx.prisma.account.update({
        where: { id: account.id },
        data: { subscriptionStatus: 'FROZEN', frozenAt: now },
      });
      await logEvent(
        ctx.prisma,
        account.id,
        'FROZEN',
        account.planId,
        account.planId,
        -monthlyValueCents(account, account.plan),
      );
      result.notices += await notify(ctx, account.id, 'overdue_5', {
        refKey: payment.id,
        vars,
        link,
      });
      result.frozen++;
    }
  }
  return result;
}

/* ------------------------------------------------------------------------ */
/* Exclusão de conta                                                         */
/* ------------------------------------------------------------------------ */

export async function deleteAccount(
  ctx: AppContext,
  account: AccountWithPlan,
  user: AuthUser,
  password: string,
) {
  if (user.role !== 'OWNER') throw new AppError('NOT_ACCOUNT_OWNER');
  const u = await ctx.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (u.isMaster)
    throw new AppError('FORBIDDEN', { reason: 'A conta master não pode ser excluída.' });
  const ok = await argon2.verify(u.passwordHash, password).catch(() => false);
  if (!ok) throw new AppError('INVALID_CREDENTIALS');
  if (account.asaasSubscriptionId) {
    const provider = await getProvider(ctx).catch(() => null);
    await provider
      ?.cancelSubscription(account.asaasSubscriptionId)
      .catch((err) => ctx.logger.warn({ err }, 'falha ao cancelar assinatura'));
  }
  const owners = await ctx.prisma.user.findMany({
    where: { accountId: account.id, role: 'OWNER' },
    select: { email: true, name: true },
  });
  await notify(ctx, account.id, 'account_deleted', {
    refKey: account.id,
    recipients: owners,
    skipInApp: true,
    vars: { conta: account.name },
  });
  await ctx.prisma.$transaction(async (tx) => {
    await tx.payment.updateMany({
      where: { accountId: account.id, status: { in: OPEN } },
      data: { status: 'CANCELED' },
    });
    await logEvent(
      tx,
      null,
      'DELETED',
      account.planId,
      null,
      -monthlyValueCents(account, account.plan),
    );
    await tx.account.delete({ where: { id: account.id } });
  });
  ctx.logger.info({ accountId: account.id }, 'conta excluída');
}
