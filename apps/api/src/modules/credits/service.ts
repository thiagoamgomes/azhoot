import type { CreditOverview, CreditPackDto } from '@azhoot/contracts';
import type { Account, CreditPack, Prisma } from '@azhoot/db';
import type { AppContext } from '../../context';
import { AppError, isUniqueViolation } from '../../lib/errors';
import { withLock } from '../../lib/lock';
import { keys } from '../../lib/redis';
import { getProvider } from '../billing/provider';
import { toPaymentDto } from '../billing/service';

type Reason = 'PLAN_GRANT' | 'PURCHASE' | 'GENERATION' | 'MASTER_ADJUST' | 'REFUND';

export function toPackDto(p: CreditPack): CreditPackDto {
  return {
    id: p.id,
    name: p.name,
    credits: p.credits,
    priceCents: p.priceCents,
    active: p.active,
    sortOrder: p.sortOrder,
  };
}

export async function listPacks(ctx: AppContext, onlyActive = true): Promise<CreditPack[]> {
  return ctx.prisma.creditPack.findMany({
    where: onlyActive ? { active: true } : {},
    orderBy: { sortOrder: 'asc' },
  });
}

export async function balanceOf(ctx: AppContext, accountId: string): Promise<number> {
  const a = await ctx.prisma.account.findUnique({
    where: { id: accountId },
    select: { aiCreditsBalance: true },
  });
  return a?.aiCreditsBalance ?? 0;
}

/**
 * Aplica uma variação de créditos de forma atômica (incremento no saldo + registro no ledger),
 * dentro de uma transação e sob lock por conta. Idempotente por (reason, refKey).
 * Retorna o novo saldo, ou null se já havia sido aplicado (idempotência).
 */
async function apply(
  ctx: AppContext,
  accountId: string,
  delta: number,
  reason: Reason,
  opts: { refKey?: string; note?: string; tx?: Prisma.TransactionClient } = {},
): Promise<number | null> {
  const run = async (tx: Prisma.TransactionClient) => {
    const acc = await tx.account.update({
      where: { id: accountId },
      data: { aiCreditsBalance: { increment: delta } },
      select: { aiCreditsBalance: true },
    });
    try {
      await tx.creditTransaction.create({
        data: {
          accountId,
          delta,
          balanceAfter: acc.aiCreditsBalance,
          reason,
          refKey: opts.refKey ?? null,
          note: opts.note ?? null,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new IdempotentSkip();
      throw err;
    }
    return acc.aiCreditsBalance;
  };
  try {
    return opts.tx ? await run(opts.tx) : await ctx.prisma.$transaction(run);
  } catch (err) {
    if (err instanceof IdempotentSkip) return null;
    throw err;
  }
}

class IdempotentSkip extends Error {}

/** Concede créditos (grátis do plano, compra, ajuste do master). Idempotente por refKey. */
export function grantCredits(
  ctx: AppContext,
  accountId: string,
  amount: number,
  reason: Reason,
  opts: { refKey?: string; note?: string; tx?: Prisma.TransactionClient } = {},
) {
  if (amount <= 0) return Promise.resolve(null);
  return apply(ctx, accountId, amount, reason, opts);
}

/** Debita créditos com verificação de saldo, sob lock por conta. Lança NO_AI_CREDITS se faltar. */
export async function debitCredits(
  ctx: AppContext,
  accountId: string,
  amount: number,
  refKey: string,
): Promise<number> {
  return withLock(ctx.redis, keys.accountLock(accountId), async () => {
    const balance = await balanceOf(ctx, accountId);
    if (balance < amount) throw new AppError('NO_AI_CREDITS', { balance, needed: amount });
    const after = await apply(ctx, accountId, -amount, 'GENERATION', { refKey });
    return after ?? balance - amount;
  });
}

/** Concede os créditos grátis incluídos no plano, uma única vez por concessão (refKey). */
export async function grantPlanCredits(
  ctx: AppContext,
  accountId: string,
  planId: string,
  credits: number,
  refKey: string,
) {
  return grantCredits(ctx, accountId, credits, 'PLAN_GRANT', {
    refKey: `${planId}:${refKey}`,
    note: `Créditos incluídos no plano ${planId}`,
  });
}

/** Ajuste manual pelo master (crédito ou débito). Sob lock; não deixa saldo negativo. */
export async function adjustCredits(
  ctx: AppContext,
  accountId: string,
  delta: number,
  note?: string,
): Promise<number> {
  return withLock(ctx.redis, keys.accountLock(accountId), async () => {
    const balance = await balanceOf(ctx, accountId);
    if (balance + delta < 0) throw new AppError('NO_AI_CREDITS', { balance, needed: -delta });
    const after = await apply(ctx, accountId, delta, 'MASTER_ADJUST', {
      refKey: `${accountId}:${Date.now()}`,
      note,
    });
    return after ?? balance + delta;
  });
}

export async function overview(ctx: AppContext, accountId: string): Promise<CreditOverview> {
  const [balance, packs, txs] = await Promise.all([
    balanceOf(ctx, accountId),
    listPacks(ctx),
    ctx.prisma.creditTransaction.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);
  return {
    balance,
    packs: packs.map(toPackDto),
    transactions: txs.map((t) => ({
      id: t.id,
      delta: t.delta,
      balanceAfter: t.balanceAfter,
      reason: t.reason,
      note: t.note,
      createdAt: t.createdAt.toISOString(),
    })),
  };
}

export interface PackCheckoutInput {
  billingName?: string;
  billingDocument?: string;
  billingEmail?: string;
  billingPhone?: string;
}

/**
 * Compra de um pacote de créditos: cobrança avulsa no provedor. Os créditos são creditados
 * quando o pagamento é confirmado (webhook/simulado → onCreditPackPaid). Serializado por conta.
 */
export async function checkoutPack(
  ctx: AppContext,
  account: Account,
  packId: string,
  input: PackCheckoutInput,
  ownerEmail: string,
) {
  return withLock(ctx.redis, keys.accountLock(account.id), async () => {
    const pack = await ctx.prisma.creditPack.findUnique({ where: { id: packId } });
    if (!pack || !pack.active) throw new AppError('CREDIT_PACK_INVALID');
    const provider = await getProvider(ctx);

    let customerId = account.asaasCustomerId;
    const docChanged = !!input.billingDocument && account.billingDocument !== input.billingDocument;
    if (!customerId || docChanged) {
      const name = input.billingName ?? account.billingName;
      const document = input.billingDocument ?? account.billingDocument;
      if (!name || !document)
        throw new AppError('BILLING_DOCUMENT_INVALID', { reason: 'Informe nome e CPF/CNPJ.' });
      customerId = await provider.createCustomer({
        name,
        document,
        email: input.billingEmail ?? account.billingEmail ?? ownerEmail,
        phone: input.billingPhone ?? account.billingPhone ?? undefined,
        externalReference: account.id,
      });
      await ctx.prisma.account.update({
        where: { id: account.id },
        data: {
          asaasCustomerId: customerId,
          billingName: name,
          billingDocument: document,
          billingEmail: input.billingEmail ?? account.billingEmail,
          billingPhone: input.billingPhone ?? account.billingPhone,
        },
      });
    }

    const charge = await provider.createCharge({
      customerId,
      valueCents: pack.priceCents,
      dueDate: new Date(),
      description: `AZhoot — ${pack.name} (créditos de IA)`,
      externalReference: account.id,
    });

    const payment = await ctx.prisma.payment.create({
      data: {
        accountId: account.id,
        accountName: account.name,
        planId: account.planId,
        kind: 'CREDIT_PACK',
        creditPackId: pack.id,
        creditsGranted: pack.credits,
        amountCents: charge.valueCents,
        netAmountCents: charge.netValueCents,
        status: charge.status,
        billingType: charge.billingType,
        description: `AZhoot — ${pack.name}`,
        dueDate: charge.dueDate,
        invoiceUrl: charge.invoiceUrl,
        provider: provider.name,
        providerId: charge.id,
      },
    });
    ctx.logger.info({ accountId: account.id, packId: pack.id }, 'compra de créditos criada');
    return { payment: toPaymentDto(payment), invoiceUrl: charge.invoiceUrl };
  });
}
