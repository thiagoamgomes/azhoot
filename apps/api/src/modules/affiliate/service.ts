import { randomBytes } from 'node:crypto';
import type { AffiliateOverview } from '@azhoot/contracts';
import type { Payment } from '@azhoot/db';
import type { AppContext } from '../../context';
import { AppError, isUniqueViolation } from '../../lib/errors';
import { getAffiliateSettings } from '../platform/settings';

function slug(s: string) {
  return s
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20);
}

/** Gera um código de indicação único e legível (ex.: "maria-silva-7k2p"). */
export async function ensureAffiliateCode(ctx: AppContext, accountId: string) {
  const acc = await ctx.prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  if (acc.affiliateCode) return acc.affiliateCode;
  for (let i = 0; i < 8; i++) {
    const code = `${slug(acc.name) || 'azhoot'}-${randomBytes(3).toString('hex').slice(0, 4)}`;
    try {
      await ctx.prisma.account.update({ where: { id: accountId }, data: { affiliateCode: code } });
      return code;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new AppError('CONFLICT');
}

export async function resolveReferral(
  ctx: AppContext,
  code: string | undefined | null,
  newUserEmail?: string,
) {
  if (!code) return null;
  const acc = await ctx.prisma.account.findUnique({
    where: { affiliateCode: code },
    include: { users: { select: { email: true } } },
  });
  if (!acc || !acc.affiliateEnabled || !acc.active) return null;
  // V11: bloqueia auto-indicação (o afiliado indicando a própria conta/e-mail).
  if (newUserEmail && acc.users.some((u) => u.email.toLowerCase() === newUserEmail.toLowerCase())) {
    ctx.logger.warn({ affiliateAccountId: acc.id }, 'auto-indicação de afiliado ignorada');
    return null;
  }
  return acc.id;
}

export async function effectivePercentBp(
  ctx: AppContext,
  affiliate: { affiliatePercentBp: number | null },
) {
  return affiliate.affiliatePercentBp ?? (await getAffiliateSettings(ctx)).percentBp;
}

/**
 * Cria a comissão do afiliado para um pagamento confirmado do indicado.
 * Idempotente (uma comissão por pagamento). Recorrente conforme configuração global.
 */
export async function createCommissionForPayment(ctx: AppContext, payment: Payment) {
  if (!payment.accountId) return null;
  const referred = await ctx.prisma.account.findUnique({ where: { id: payment.accountId } });
  if (!referred?.referredByAccountId) return null;
  const affiliate = await ctx.prisma.account.findUnique({
    where: { id: referred.referredByAccountId },
  });
  if (!affiliate?.affiliateEnabled) return null;
  const settings = await getAffiliateSettings(ctx);
  if (!settings.recurring) {
    const already = await ctx.prisma.commission.count({
      where: { referredAccountId: referred.id, status: { not: 'CANCELED' } },
    });
    if (already > 0) return null;
  }
  const percentBp = await effectivePercentBp(ctx, affiliate);
  const amountCents = Math.round((payment.amountCents * percentBp) / 10000);
  if (amountCents <= 0) return null;
  try {
    return await ctx.prisma.commission.create({
      data: {
        affiliateAccountId: affiliate.id,
        referredAccountId: referred.id,
        referredName: referred.name,
        paymentId: payment.id,
        percentBp,
        baseAmountCents: payment.amountCents,
        amountCents,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) return null;
    throw err;
  }
}

export async function cancelCommissionForPayment(ctx: AppContext, paymentId: string) {
  await ctx.prisma.commission.updateMany({
    where: { paymentId, status: 'PENDING' },
    data: { status: 'CANCELED' },
  });
}

/** Mascara nome do indicado para privacidade ("Maria S."). */
function maskName(name: string) {
  const [first, ...rest] = name.trim().split(/\s+/);
  return rest.length ? `${first} ${rest[rest.length - 1]![0]}.` : (first ?? '');
}

export async function affiliateOverview(
  ctx: AppContext,
  accountId: string,
): Promise<AffiliateOverview> {
  const acc = await ctx.prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  if (!acc.affiliateEnabled) throw new AppError('AFFILIATE_DISABLED');
  const code = await ensureAffiliateCode(ctx, accountId);
  const [referrals, commissions, percentBp] = await Promise.all([
    ctx.prisma.account.findMany({
      where: { referredByAccountId: accountId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        planId: true,
        createdAt: true,
        billingExempt: true,
        payments: {
          where: { status: { in: ['CONFIRMED', 'RECEIVED'] } },
          orderBy: { paidAt: 'desc' },
          take: 1,
          select: { paidAt: true },
        },
      },
    }),
    ctx.prisma.commission.findMany({
      where: { affiliateAccountId: accountId },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    effectivePercentBp(ctx, acc),
  ]);
  const earnedBy = new Map<string, number>();
  for (const c of commissions) {
    if (c.status === 'CANCELED' || !c.referredAccountId) continue;
    earnedBy.set(c.referredAccountId, (earnedBy.get(c.referredAccountId) ?? 0) + c.amountCents);
  }
  const paying = referrals.filter((r) => r.planId !== 'FREE' && r.payments.length > 0);
  return {
    code,
    link: `${ctx.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/cadastro?ref=${code}`,
    percentBp,
    pixKeyType: acc.pixKeyType,
    pixKey: acc.pixKey,
    totals: {
      referrals: referrals.length,
      paying: paying.length,
      pendingCents: commissions
        .filter((c) => c.status === 'PENDING')
        .reduce((a, c) => a + c.amountCents, 0),
      paidCents: commissions
        .filter((c) => c.status === 'PAID')
        .reduce((a, c) => a + c.amountCents, 0),
    },
    referrals: referrals.map((r) => ({
      id: r.id,
      name: maskName(r.name),
      planId: r.planId,
      createdAt: r.createdAt.toISOString(),
      paying: r.planId !== 'FREE' && r.payments.length > 0,
      lastPaymentAt: r.payments[0]?.paidAt?.toISOString() ?? null,
      earnedCents: earnedBy.get(r.id) ?? 0,
    })),
    commissions: commissions.map((c) => ({
      id: c.id,
      referredName: maskName(c.referredName),
      baseAmountCents: c.baseAmountCents,
      percentBp: c.percentBp,
      amountCents: c.amountCents,
      status: c.status,
      createdAt: c.createdAt.toISOString(),
      paidAt: c.paidAt?.toISOString() ?? null,
    })),
  };
}
