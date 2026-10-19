import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { appSettingsSchema, NOTIFICATION_TYPES, planIdSchema } from '@azhoot/contracts';
import type { Prisma } from '@azhoot/db';
import type { AppContext } from '../../context';
import { audit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { parse } from '../../middleware/validate';
import { ensureAffiliateCode, effectivePercentBp } from '../affiliate/service';
import { hashPassword } from '../auth/service';
import {
  clearPlanCache,
  effectiveLimits,
  effectivePrice,
  getPlan,
  getPlans,
  monthlyValueCents,
  toPlanDto,
} from '../billing/plans';
import { AsaasProvider, getProvider } from '../billing/provider';
import * as billing from '../billing/service';
import { sendEmail, toHtml } from '../notifications/mailer';
import { notify } from '../notifications/service';
import {
  affiliateSettingsInput,
  aiSettingsInput,
  asaasSettingsInput,
  emailSettingsInput,
  getAffiliateSettings,
  getAsaasSettings,
  publicAiSettings,
  publicAsaasSettings,
  publicEmailSettings,
  saveAffiliateSettings,
  saveAiSettings,
  saveAsaasSettings,
  saveEmailSettings,
} from '../platform/settings';
import * as credits from '../credits/service';
import { getSettings, saveSettings } from '../settings/service';
import { analytics, currentMrr } from './analytics';

const idParam = z.object({ id: z.uuid() });
const intOrNull = z.number().int().min(0).max(1_000_000).nullable();

const range = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
});

function parseRange(q: unknown, defaultMonths = 12) {
  const { from, to } = parse(range, q);
  const end = to ? new Date(`${to}T23:59:59.999-03:00`) : new Date();
  const start = from
    ? new Date(`${from}T00:00:00-03:00`)
    : (() => {
        const d = new Date(end);
        d.setMonth(d.getMonth() - defaultMonths + 1, 1);
        d.setHours(0, 0, 0, 0);
        return d;
      })();
  return { from: start, to: end };
}

export function masterRoutes(ctx: AppContext) {
  const r = Router();
  const act = (
    req: Parameters<Parameters<typeof r.get>[1]>[0],
    action: Parameters<typeof audit>[1]['action'],
    entityId?: string,
    metadata?: Record<string, unknown>,
  ) =>
    audit(ctx, {
      actorId: req.user!.id,
      action,
      entityType: 'account',
      entityId,
      metadata,
      ip: req.ip,
      requestId: req.id,
    });

  /* -------------------------------- dashboard ------------------------------ */

  r.get('/dashboard', async (_req, res) => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const thirty = new Date(now.getTime() - 30 * 86400_000);
    const yearAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const [
      mrr,
      totalAccounts,
      byPlan,
      byStatus,
      signups30,
      revenueMonth,
      pending,
      overdue,
      commissionsPending,
      recentAccounts,
      recentPayments,
      series,
    ] = await Promise.all([
      currentMrr(ctx),
      ctx.prisma.account.count(),
      ctx.prisma.account.groupBy({ by: ['planId'], _count: true }),
      ctx.prisma.account.groupBy({
        by: ['subscriptionStatus'],
        where: { planId: { not: 'FREE' } },
        _count: true,
      }),
      ctx.prisma.account.count({ where: { createdAt: { gte: thirty } } }),
      ctx.prisma.payment.aggregate({
        where: { status: { in: ['CONFIRMED', 'RECEIVED'] }, paidAt: { gte: monthStart } },
        _sum: { amountCents: true },
      }),
      ctx.prisma.payment.aggregate({
        where: { status: 'PENDING' },
        _sum: { amountCents: true },
        _count: true,
      }),
      ctx.prisma.payment.aggregate({
        where: { status: 'OVERDUE' },
        _sum: { amountCents: true },
        _count: true,
      }),
      ctx.prisma.commission.aggregate({
        where: { status: 'PENDING' },
        _sum: { amountCents: true },
        _count: true,
      }),
      ctx.prisma.account.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          users: { where: { role: 'OWNER' }, take: 1, select: { name: true, email: true } },
        },
      }),
      ctx.prisma.payment.findMany({ orderBy: { updatedAt: 'desc' }, take: 8 }),
      analytics(ctx, yearAgo, now),
    ]);
    res.json({
      mrrCents: mrr.mrrCents,
      arrCents: mrr.mrrCents * 12,
      payingAccounts: mrr.payingAccounts,
      totalAccounts,
      byPlan: Object.fromEntries(byPlan.map((p) => [p.planId, p._count])),
      pastDue: byStatus.find((s) => s.subscriptionStatus === 'PAST_DUE')?._count ?? 0,
      frozen: byStatus.find((s) => s.subscriptionStatus === 'FROZEN')?._count ?? 0,
      signups30,
      revenueMonthCents: revenueMonth._sum.amountCents ?? 0,
      pending: { cents: pending._sum.amountCents ?? 0, count: pending._count },
      overdue: { cents: overdue._sum.amountCents ?? 0, count: overdue._count },
      commissionsPending: {
        cents: commissionsPending._sum.amountCents ?? 0,
        count: commissionsPending._count,
      },
      recentAccounts: recentAccounts.map((a) => ({
        id: a.id,
        name: a.name,
        ownerName: a.users[0]?.name ?? null,
        ownerEmail: a.users[0]?.email ?? null,
        planId: a.planId,
        createdAt: a.createdAt.toISOString(),
      })),
      recentPayments: recentPayments.map(billing.toPaymentDto),
      series: series.series,
    });
  });

  r.get('/analytics', async (req, res) => {
    const { from, to } = parseRange(req.query);
    res.json(await analytics(ctx, from, to));
  });

  /* --------------------------------- contas -------------------------------- */

  r.get('/accounts', async (req, res) => {
    const q = parse(
      z.object({
        search: z.string().trim().max(120).optional(),
        plan: z.enum(['ALL', 'FREE', 'MONTHLY', 'YEARLY']).default('ALL'),
        status: z
          .enum(['ALL', 'ACTIVE', 'PAST_DUE', 'FROZEN', 'INACTIVE', 'AFFILIATE'])
          .default('ALL'),
        page: z.coerce.number().int().min(1).default(1),
      }),
      req.query,
    );
    const where: Prisma.AccountWhereInput = {
      ...(q.plan !== 'ALL' ? { planId: q.plan } : {}),
      ...(q.status === 'INACTIVE'
        ? { active: false }
        : q.status === 'AFFILIATE'
          ? { affiliateEnabled: true }
          : q.status !== 'ALL'
            ? { subscriptionStatus: q.status }
            : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              {
                users: {
                  some: {
                    OR: [
                      { email: { contains: q.search, mode: 'insensitive' } },
                      { name: { contains: q.search, mode: 'insensitive' } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };
    const pageSize = 25;
    const [total, rows, plans] = await Promise.all([
      ctx.prisma.account.count({ where }),
      ctx.prisma.account.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * pageSize,
        take: pageSize,
        include: {
          users: {
            where: { role: 'OWNER' },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { id: true, name: true, email: true, lastLoginAt: true, isMaster: true },
          },
          _count: { select: { quizzes: true, users: true, sessions: true, referrals: true } },
        },
      }),
      getPlans(ctx),
    ]);
    const byId = new Map(plans.map((p) => [p.id, p]));
    res.json({
      total,
      page: q.page,
      pageSize,
      items: rows.map((a) => ({
        id: a.id,
        name: a.name,
        active: a.active,
        planId: a.planId,
        subscriptionStatus: a.subscriptionStatus,
        billingExempt: a.billingExempt,
        affiliateEnabled: a.affiliateEnabled,
        currentPeriodEnd: a.currentPeriodEnd?.toISOString() ?? null,
        mrrCents: byId.get(a.planId) ? monthlyValueCents(a, byId.get(a.planId)!) : 0,
        owner: a.users[0]
          ? { ...a.users[0], lastLoginAt: a.users[0].lastLoginAt?.toISOString() ?? null }
          : null,
        counts: a._count,
        createdAt: a.createdAt.toISOString(),
      })),
    });
  });

  r.get('/accounts/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const account = await billing.loadAccount(ctx, id);
    const [users, payments, events, usage, commissionsEarned, referrals, plans, percentBp] =
      await Promise.all([
        ctx.prisma.user.findMany({ where: { accountId: id }, orderBy: { createdAt: 'asc' } }),
        ctx.prisma.payment.findMany({
          where: { accountId: id },
          orderBy: { dueDate: 'desc' },
          take: 100,
        }),
        ctx.prisma.subscriptionEvent.findMany({
          where: { accountId: id },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
        billing.usage(ctx, id),
        ctx.prisma.commission.findMany({
          where: { affiliateAccountId: id },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
        ctx.prisma.account.findMany({
          where: { referredByAccountId: id },
          select: { id: true, name: true, planId: true, createdAt: true },
        }),
        getPlans(ctx),
        effectivePercentBp(ctx, account),
      ]);
    const referredBy = account.referredByAccountId
      ? await ctx.prisma.account.findUnique({
          where: { id: account.referredByAccountId },
          select: { id: true, name: true },
        })
      : null;
    res.json({
      account: {
        id: account.id,
        name: account.name,
        active: account.active,
        planId: account.planId,
        planName: account.plan.name,
        subscriptionStatus: account.subscriptionStatus,
        billingExempt: account.billingExempt,
        currentPeriodStart: account.currentPeriodStart?.toISOString() ?? null,
        currentPeriodEnd: account.currentPeriodEnd?.toISOString() ?? null,
        pendingPlanId: account.pendingPlanId,
        pendingChangeAt: account.pendingChangeAt?.toISOString() ?? null,
        frozenAt: account.frozenAt?.toISOString() ?? null,
        firstPaidAt: account.firstPaidAt?.toISOString() ?? null,
        createdAt: account.createdAt.toISOString(),
        billing: {
          name: account.billingName,
          document: account.billingDocument,
          email: account.billingEmail,
          phone: account.billingPhone,
        },
        asaasCustomerId: account.asaasCustomerId,
        asaasSubscriptionId: account.asaasSubscriptionId,
        overrides: {
          maxQuizzes: account.overrideMaxQuizzes,
          unlimitedQuizzes: account.overrideUnlimitedQuizzes,
          maxParticipants: account.overrideMaxParticipants,
          maxUsers: account.overrideMaxUsers,
          priceCents: account.overridePriceCents,
        },
        effectiveLimits: effectiveLimits(account, account.plan),
        effectivePriceCents: effectivePrice(account, account.plan),
        mrrCents: monthlyValueCents(account, account.plan),
        affiliate: {
          enabled: account.affiliateEnabled,
          code: account.affiliateCode,
          percentBp: account.affiliatePercentBp,
          effectivePercentBp: percentBp,
          pixKeyType: account.pixKeyType,
          pixKey: account.pixKey,
        },
        referredBy,
        aiCreditsBalance: account.aiCreditsBalance,
      },
      creditTransactions: (
        await ctx.prisma.creditTransaction.findMany({
          where: { accountId: id },
          orderBy: { createdAt: 'desc' },
          take: 30,
        })
      ).map((t) => ({
        id: t.id,
        delta: t.delta,
        balanceAfter: t.balanceAfter,
        reason: t.reason,
        note: t.note,
        createdAt: t.createdAt.toISOString(),
      })),
      usage,
      plans: plans.map(toPlanDto),
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        active: u.active,
        isMaster: u.isMaster,
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        createdAt: u.createdAt.toISOString(),
      })),
      payments: payments.map(billing.toPaymentDto),
      events: events.map((e) => ({
        id: String(e.id),
        type: e.type,
        fromPlanId: e.fromPlanId,
        toPlanId: e.toPlanId,
        mrrDeltaCents: e.mrrDeltaCents,
        createdAt: e.createdAt.toISOString(),
      })),
      referrals: referrals.map((x) => ({ ...x, createdAt: x.createdAt.toISOString() })),
      commissions: commissionsEarned.map((c) => ({
        id: c.id,
        referredName: c.referredName,
        amountCents: c.amountCents,
        baseAmountCents: c.baseAmountCents,
        percentBp: c.percentBp,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
        paidAt: c.paidAt?.toISOString() ?? null,
        paidNote: c.paidNote,
      })),
    });
  });

  r.patch('/accounts/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const input = parse(
      z.object({
        name: z.string().trim().min(2).max(120).optional(),
        active: z.boolean().optional(),
        billingExempt: z.boolean().optional(),
        overrides: z
          .object({
            maxQuizzes: intOrNull.optional(),
            unlimitedQuizzes: z.boolean().optional(),
            maxParticipants: z.number().int().min(2).max(200).nullable().optional(),
            maxUsers: z.number().int().min(1).max(1000).nullable().optional(),
            priceCents: intOrNull.optional(),
          })
          .optional(),
        affiliateEnabled: z.boolean().optional(),
        affiliatePercentBp: z.number().int().min(0).max(10000).nullable().optional(),
      }),
      req.body,
    );
    const account = await billing.loadAccount(ctx, id);
    const o = input.overrides;
    const updated = await ctx.prisma.account.update({
      where: { id },
      data: {
        name: input.name,
        active: input.active,
        billingExempt: input.billingExempt,
        affiliateEnabled: input.affiliateEnabled,
        affiliatePercentBp: input.affiliatePercentBp,
        ...(o
          ? {
              overrideMaxQuizzes: o.maxQuizzes,
              overrideUnlimitedQuizzes: o.unlimitedQuizzes,
              overrideMaxParticipants: o.maxParticipants,
              overrideMaxUsers: o.maxUsers,
              overridePriceCents: o.priceCents,
            }
          : {}),
      },
      include: { plan: true },
    });
    if (input.affiliateEnabled) await ensureAffiliateCode(ctx, id);
    if (input.active === false) {
      await ctx.prisma.adminSession.deleteMany({ where: { user: { accountId: id } } });
    }
    // Preço especial: atualiza a assinatura no Asaas para as próximas cobranças
    if (
      o?.priceCents !== undefined &&
      updated.asaasSubscriptionId &&
      !updated.asaasSubscriptionId.startsWith('sim_')
    ) {
      const provider = await getProvider(ctx);
      if (provider instanceof AsaasProvider)
        await provider.updateSubscriptionValue(
          updated.asaasSubscriptionId,
          effectivePrice(updated, updated.plan),
        );
    }
    if (input.billingExempt !== undefined && input.billingExempt !== account.billingExempt) {
      await ctx.prisma.subscriptionEvent.create({
        data: {
          accountId: id,
          type: input.billingExempt ? 'EXEMPT_ON' : 'EXEMPT_OFF',
          fromPlanId: account.planId,
          toPlanId: account.planId,
          mrrDeltaCents: input.billingExempt
            ? -monthlyValueCents(account, account.plan)
            : monthlyValueCents({ ...account, billingExempt: false }, account.plan),
        },
      });
    }
    await act(req, 'master.account_updated', id, { fields: Object.keys(input) });
    res.status(204).end();
  });

  /** Define o plano diretamente (cortesia/ajuste), aplicando já. Excedentes são arquivados/desativados. */
  r.post('/accounts/:id/plan', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const input = parse(
      z.object({ planId: planIdSchema, exempt: z.boolean().default(true) }),
      req.body,
    );
    let account = await billing.loadAccount(ctx, id);
    const target = await getPlan(ctx, input.planId);
    if (!target) throw new AppError('PLAN_INVALID');
    if (input.exempt !== account.billingExempt) {
      account = await ctx.prisma.account.update({
        where: { id },
        data: { billingExempt: input.exempt },
        include: { plan: true },
      });
    }
    await billing.applyPlanNow(ctx, account, target, { quizIds: [], userIds: [] }, 'MASTER');
    await act(req, 'master.account_updated', id, { planId: input.planId, exempt: input.exempt });
    res.status(204).end();
  });

  r.post('/accounts/:id/reset-password', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const input = parse(
      z.object({ userId: z.uuid().optional(), sendEmail: z.boolean().default(true) }),
      req.body ?? {},
    );
    const user = await ctx.prisma.user.findFirst({
      where: { accountId: id, ...(input.userId ? { id: input.userId } : { role: 'OWNER' }) },
      orderBy: { createdAt: 'asc' },
    });
    if (!user) throw new AppError('NOT_FOUND');
    const temporary = `${randomBytes(6).toString('base64url')}-${randomBytes(3).toString('hex')}`;
    await ctx.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(temporary), mustChangePassword: true },
    });
    await ctx.prisma.adminSession.deleteMany({ where: { userId: user.id } });
    if (input.sendEmail) {
      const text = `Olá, ${user.name}!\n\nSua senha do AZhoot foi redefinida pelo suporte.\n\nSenha temporária: ${temporary}\n\nEntre em ${ctx.env.PUBLIC_WEB_URL}/login e troque a senha em Configurações.`;
      await sendEmail(ctx, {
        to: user.email,
        subject: 'Sua senha do AZhoot foi redefinida',
        text,
        html: toHtml('Sua senha foi redefinida', text),
      }).catch((err) => ctx.logger.warn({ err }, 'falha ao enviar senha temporária'));
    }
    await act(req, 'master.password_reset', id, { userId: user.id, emailed: input.sendEmail });
    res.json({ userId: user.id, email: user.email, temporaryPassword: temporary });
  });

  r.patch('/users/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const input = parse(z.object({ active: z.boolean() }), req.body);
    const user = await ctx.prisma.user.findUnique({ where: { id } });
    if (!user) throw new AppError('NOT_FOUND');
    if (user.isMaster && !input.active) throw new AppError('CANNOT_MODIFY_SELF');
    await ctx.prisma.user.update({ where: { id }, data: { active: input.active } });
    if (!input.active) await ctx.prisma.adminSession.deleteMany({ where: { userId: id } });
    await act(req, 'master.account_updated', user.accountId ?? undefined, {
      userId: id,
      active: input.active,
    });
    res.status(204).end();
  });

  /* ------------------------------- receitas -------------------------------- */

  r.get('/payments', async (req, res) => {
    const q = parse(
      z.object({
        status: z
          .enum([
            'ALL',
            'PENDING',
            'CONFIRMED',
            'RECEIVED',
            'OVERDUE',
            'CANCELED',
            'REFUNDED',
            'PAID',
          ])
          .default('ALL'),
        search: z.string().trim().max(120).optional(),
        from: z.iso.date().optional(),
        to: z.iso.date().optional(),
        page: z.coerce.number().int().min(1).default(1),
      }),
      req.query,
    );
    const where: Prisma.PaymentWhereInput = {
      ...(q.status === 'PAID'
        ? { status: { in: ['CONFIRMED', 'RECEIVED'] } }
        : q.status !== 'ALL'
          ? { status: q.status }
          : {}),
      ...(q.search ? { accountName: { contains: q.search, mode: 'insensitive' } } : {}),
      ...(q.from || q.to
        ? {
            dueDate: {
              ...(q.from ? { gte: new Date(`${q.from}T00:00:00-03:00`) } : {}),
              ...(q.to ? { lte: new Date(`${q.to}T23:59:59-03:00`) } : {}),
            },
          }
        : {}),
    };
    const pageSize = 30;
    const [total, items, totals] = await Promise.all([
      ctx.prisma.payment.count({ where }),
      ctx.prisma.payment.findMany({
        where,
        orderBy: { dueDate: 'desc' },
        skip: (q.page - 1) * pageSize,
        take: pageSize,
      }),
      ctx.prisma.payment.groupBy({
        by: ['status'],
        where,
        _sum: { amountCents: true },
        _count: true,
      }),
    ]);
    res.json({
      total,
      page: q.page,
      pageSize,
      items: items.map(billing.toPaymentDto),
      totals: Object.fromEntries(
        totals.map((t) => [t.status, { cents: t._sum.amountCents ?? 0, count: t._count }]),
      ),
    });
  });

  /** Confirma recebimento manual (dinheiro/transferência). No Asaas registra "recebido em dinheiro". */
  r.post('/payments/:id/mark-paid', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const p = await ctx.prisma.payment.findUnique({ where: { id } });
    if (!p || !p.providerId) throw new AppError('NOT_FOUND');
    if (!['PENDING', 'OVERDUE'].includes(p.status)) throw new AppError('INVALID_TRANSITION');
    const provider = await getProvider(ctx);
    if (provider instanceof AsaasProvider && p.provider === 'asaas')
      await provider.receiveInCash(p.providerId, p.amountCents);
    await billing.handleProviderPayment(
      ctx,
      {
        id: p.providerId,
        subscriptionId: p.providerSubscriptionId,
        status: 'RECEIVED',
        valueCents: p.amountCents,
        netValueCents: p.netAmountCents,
        dueDate: p.dueDate,
        paidAt: new Date(),
        invoiceUrl: p.invoiceUrl,
        billingType: 'MANUAL',
      },
      p.provider,
    );
    await act(req, 'master.payment_marked', p.accountId ?? undefined, { paymentId: id });
    res.status(204).end();
  });

  /* ------------------------------- despesas -------------------------------- */

  const expenseInput = z.object({
    description: z.string().trim().min(2).max(200),
    category: z.enum(['MARKETING', 'INFRA', 'PESSOAL', 'IMPOSTOS', 'FERRAMENTAS', 'OUTROS']),
    channel: z.string().trim().max(60).nullable().optional(),
    amountCents: z.number().int().min(1).max(100_000_000),
    date: z.iso.date(),
  });

  r.get('/expenses', async (req, res) => {
    const { from, to } = parseRange(req.query, 12);
    const day = (d: Date) =>
      new Date(`${d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })}T00:00:00Z`);
    const items = await ctx.prisma.expense.findMany({
      where: { date: { gte: day(from), lte: day(to) } },
      orderBy: { date: 'desc' },
    });
    res.json({
      items: items.map((e) => ({
        ...e,
        date: e.date.toISOString().slice(0, 10),
        createdAt: e.createdAt.toISOString(),
        updatedAt: e.updatedAt.toISOString(),
      })),
      totalCents: items.reduce((a, e) => a + e.amountCents, 0),
    });
  });

  r.post('/expenses', async (req, res) => {
    const input = parse(expenseInput, req.body);
    const e = await ctx.prisma.expense.create({
      data: { ...input, channel: input.channel ?? null, date: new Date(`${input.date}T00:00:00Z`) },
    });
    await act(req, 'master.expense_changed', undefined, { expenseId: e.id, op: 'create' });
    res.status(201).json({ id: e.id });
  });

  r.put('/expenses/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const input = parse(expenseInput, req.body);
    await ctx.prisma.expense.update({
      where: { id },
      data: { ...input, channel: input.channel ?? null, date: new Date(`${input.date}T00:00:00Z`) },
    });
    await act(req, 'master.expense_changed', undefined, { expenseId: id, op: 'update' });
    res.status(204).end();
  });

  r.delete('/expenses/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    await ctx.prisma.expense.delete({ where: { id } });
    await act(req, 'master.expense_changed', undefined, { expenseId: id, op: 'delete' });
    res.status(204).end();
  });

  /* ------------------------------- afiliados ------------------------------- */

  r.get('/commissions', async (req, res) => {
    const { status } = parse(
      z.object({ status: z.enum(['ALL', 'PENDING', 'PAID', 'CANCELED']).default('PENDING') }),
      req.query,
    );
    const items = await ctx.prisma.commission.findMany({
      where: status === 'ALL' ? {} : { status },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { affiliate: { select: { id: true, name: true, pixKeyType: true, pixKey: true } } },
    });
    const byAffiliate = new Map<
      string,
      {
        accountId: string;
        name: string;
        pixKeyType: string | null;
        pixKey: string | null;
        pendingCents: number;
        count: number;
      }
    >();
    for (const c of items) {
      if (!c.affiliate || c.status !== 'PENDING') continue;
      const cur = byAffiliate.get(c.affiliate.id) ?? {
        accountId: c.affiliate.id,
        name: c.affiliate.name,
        pixKeyType: c.affiliate.pixKeyType,
        pixKey: c.affiliate.pixKey,
        pendingCents: 0,
        count: 0,
      };
      cur.pendingCents += c.amountCents;
      cur.count++;
      byAffiliate.set(c.affiliate.id, cur);
    }
    res.json({
      affiliates: [...byAffiliate.values()].sort((a, b) => b.pendingCents - a.pendingCents),
      items: items.map((c) => ({
        id: c.id,
        affiliateAccountId: c.affiliateAccountId,
        affiliateName: c.affiliate?.name ?? '(conta excluída)',
        referredName: c.referredName,
        baseAmountCents: c.baseAmountCents,
        percentBp: c.percentBp,
        amountCents: c.amountCents,
        status: c.status,
        createdAt: c.createdAt.toISOString(),
        paidAt: c.paidAt?.toISOString() ?? null,
        paidNote: c.paidNote,
      })),
    });
  });

  /** Marca comissões como pagas (após o PIX manual). Aceita ids ou todas as pendentes de um afiliado. */
  r.post('/commissions/pay', async (req, res) => {
    const input = parse(
      z.object({
        ids: z.array(z.uuid()).max(500).optional(),
        affiliateAccountId: z.uuid().optional(),
        note: z.string().trim().max(300).optional(),
      }),
      req.body,
    );
    if (!input.ids?.length && !input.affiliateAccountId) throw new AppError('VALIDATION_FAILED');
    const result = await ctx.prisma.commission.updateMany({
      where: {
        status: 'PENDING',
        ...(input.ids?.length ? { id: { in: input.ids } } : {}),
        ...(input.affiliateAccountId ? { affiliateAccountId: input.affiliateAccountId } : {}),
      },
      data: { status: 'PAID', paidAt: new Date(), paidNote: input.note ?? null },
    });
    await act(req, 'master.commission_paid', input.affiliateAccountId, { count: result.count });
    res.json({ paid: result.count });
  });

  /* ------------------------------ configurações ---------------------------- */

  r.get('/plans', async (_req, res) => {
    res.json({ items: (await getPlans(ctx)).map(toPlanDto) });
  });

  r.put('/plans/:id', async (req, res) => {
    const id = planIdSchema.parse(req.params.id);
    const input = parse(
      z.object({
        name: z.string().trim().min(2).max(60),
        description: z.string().trim().max(300).nullable().optional(),
        priceCents: z.number().int().min(0).max(10_000_000),
        maxQuizzes: intOrNull,
        maxParticipants: z.number().int().min(2).max(200),
        maxUsers: z.number().int().min(1).max(1000),
        features: z.array(z.string().trim().min(1).max(120)).max(20),
        aiCreditsIncluded: z.number().int().min(0).max(100000),
        active: z.boolean(),
      }),
      req.body,
    );
    if (id === 'FREE' && input.priceCents !== 0)
      throw new AppError('VALIDATION_FAILED', {
        fields: { priceCents: 'O plano Gratuito não tem preço.' },
      });
    if (id === 'FREE' && !input.active)
      throw new AppError('VALIDATION_FAILED', {
        fields: { active: 'O plano Gratuito não pode ser desativado.' },
      });
    await ctx.prisma.plan.update({
      where: { id },
      data: { ...input, description: input.description ?? null },
    });
    clearPlanCache();
    await act(req, 'master.settings_updated', undefined, { plan: id });
    res.json(toPlanDto((await getPlan(ctx, id))!));
  });

  r.get('/settings/email', async (_req, res) => res.json(await publicEmailSettings(ctx)));
  r.put('/settings/email', async (req, res) => {
    await saveEmailSettings(ctx, parse(emailSettingsInput, req.body));
    await act(req, 'master.settings_updated', undefined, { section: 'email' });
    res.json(await publicEmailSettings(ctx));
  });
  r.post('/settings/email/test', async (req, res) => {
    const { to, type } = parse(
      z.object({ to: z.email(), type: z.enum(NOTIFICATION_TYPES).optional() }),
      req.body,
    );
    try {
      const result = type
        ? await notify(ctx, req.user!.accountId, type, {
            refKey: `test:${Date.now()}`,
            recipients: [{ email: to, name: req.user!.name }],
            skipInApp: true,
            vars: {
              valor: 'R$ 9,90',
              vencimento: new Date().toLocaleDateString('pt-BR'),
              relatorio: 'Sessões realizadas: 3\nParticipantes: 42',
              plano_anterior: 'Gratuito',
            },
          })
        : (
            await sendEmail(ctx, {
              to,
              subject: 'Teste de e-mail do AZhoot',
              text: 'Se você recebeu esta mensagem, o envio está configurado.',
              html: toHtml(
                'Teste de e-mail',
                'Se você recebeu esta mensagem, o envio está configurado.',
              ),
            })
          ).status;
      res.json({ ok: true, result });
    } catch (err) {
      res.json({ ok: false, error: (err as Error).message });
    }
  });

  r.get('/settings/asaas', async (_req, res) => res.json(await publicAsaasSettings(ctx)));
  r.put('/settings/asaas', async (req, res) => {
    await saveAsaasSettings(ctx, parse(asaasSettingsInput, req.body));
    await act(req, 'master.settings_updated', undefined, { section: 'asaas' });
    res.json(await publicAsaasSettings(ctx));
  });
  r.post('/settings/asaas/test', async (_req, res) => {
    const s = await getAsaasSettings(ctx);
    if (!s.apiKey) return res.json({ ok: false, error: 'Chave de API não configurada.' });
    try {
      await new AsaasProvider(s.apiKey, s.environment).ping();
      res.json({ ok: true });
    } catch (err) {
      res.json({
        ok: false,
        error: (err as AppError).details?.description ?? (err as Error).message,
      });
    }
  });

  r.get('/settings/affiliate', async (_req, res) => res.json(await getAffiliateSettings(ctx)));
  r.put('/settings/affiliate', async (req, res) => {
    const input = parse(affiliateSettingsInput, req.body);
    await saveAffiliateSettings(ctx, input);
    await act(req, 'master.settings_updated', undefined, { section: 'affiliate' });
    res.json(input);
  });

  r.get('/settings/platform', async (_req, res) => res.json(await getSettings(ctx)));
  r.put('/settings/platform', async (req, res) => {
    const saved = await saveSettings(ctx, parse(appSettingsSchema, req.body));
    await act(req, 'master.settings_updated', undefined, { section: 'platform' });
    res.json(saved);
  });

  /* ----------------------------------- IA ---------------------------------- */

  r.get('/settings/ai', async (_req, res) => res.json(await publicAiSettings(ctx)));
  r.put('/settings/ai', async (req, res) => {
    await saveAiSettings(ctx, parse(aiSettingsInput, req.body));
    await act(req, 'master.settings_updated', undefined, { section: 'ai' });
    res.json(await publicAiSettings(ctx));
  });

  /* ---------------------------- pacotes de crédito ------------------------- */

  const packInput = z.object({
    name: z.string().trim().min(2).max(60),
    credits: z.number().int().min(1).max(100000),
    priceCents: z.number().int().min(0).max(100_000_000),
    active: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(1000).default(0),
  });

  r.get('/credit-packs', async (_req, res) => {
    res.json({ items: (await credits.listPacks(ctx, false)).map(credits.toPackDto) });
  });
  r.post('/credit-packs', async (req, res) => {
    const input = parse(packInput, req.body);
    const p = await ctx.prisma.creditPack.create({ data: input });
    await act(req, 'master.credit_pack_changed', undefined, { id: p.id, op: 'create' });
    res.status(201).json(credits.toPackDto(p));
  });
  r.put('/credit-packs/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const input = parse(packInput, req.body);
    const p = await ctx.prisma.creditPack.update({ where: { id }, data: input });
    await act(req, 'master.credit_pack_changed', undefined, { id, op: 'update' });
    res.json(credits.toPackDto(p));
  });
  r.delete('/credit-packs/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    await ctx.prisma.creditPack.delete({ where: { id } });
    await act(req, 'master.credit_pack_changed', undefined, { id, op: 'delete' });
    res.status(204).end();
  });

  /** Ajuste manual de créditos de uma conta (cortesia/suporte). */
  r.post('/accounts/:id/credits', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const input = parse(
      z.object({
        delta: z
          .number()
          .int()
          .refine((n) => n !== 0),
        note: z.string().trim().max(200).optional(),
      }),
      req.body,
    );
    await billing.loadAccount(ctx, id);
    const balance = await credits.adjustCredits(ctx, id, input.delta, input.note);
    await act(req, 'master.credits_adjusted', id, { delta: input.delta });
    res.json({ balance });
  });

  r.get('/notifications/deliveries', async (_req, res) => {
    const items = await ctx.prisma.notificationDelivery.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ items: items.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })) });
  });

  /** Executa a rotina de cobrança imediatamente (útil para testes e suporte). */
  r.post('/jobs/billing', async (_req, res) => {
    res.json(await billing.runBillingCycle(ctx));
  });

  return r;
}
