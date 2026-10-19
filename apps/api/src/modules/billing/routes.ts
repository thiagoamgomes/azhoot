import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { safeEqual } from '../../lib/crypto';
import { AppError, isUniqueViolation } from '../../lib/errors';
import { rateLimit } from '../../middleware/rateLimit';
import { loadUser, requireAuth } from '../auth/middleware';
import { getAsaasSettings } from '../platform/settings';
import { AsaasProvider, fromAsaasPayment, getProvider, type AsaasPaymentJson } from './provider';
import { getPlans, toPlanDto } from './plans';
import { handleProviderPayment, toPaymentDto } from './service';

/** Webhook do Asaas: eventos PAYMENT_* autenticados pelo header `asaas-access-token`. */
export function webhookRoutes(ctx: AppContext) {
  const r = Router();
  // V2: limita a superfície do webhook (escreve no banco) por IP.
  r.post('/asaas', rateLimit(ctx, 'webhook-asaas', 240, 60), async (req, res) => {
    const { webhookToken } = await getAsaasSettings(ctx);
    const got = req.header('asaas-access-token') ?? '';
    if (!webhookToken || !got || !safeEqual(got, webhookToken)) {
      ctx.metrics.inc('azhoot_webhook_unauthorized_total');
      ctx.logger.warn({ ip: req.ip }, 'webhook Asaas com token inválido');
      throw new AppError('WEBHOOK_UNAUTHORIZED');
    }
    const body = req.body as { id?: string; event?: string; payment?: AsaasPaymentJson };
    ctx.metrics.inc('azhoot_webhooks_total', { event: body.event ?? 'unknown' });

    if (body.event?.startsWith('PAYMENT_') && body.payment?.id) {
      // V6: idempotência — ignora reenvio do mesmo evento.
      const eventId = body.id ?? `${body.event}:${body.payment.id}:${body.payment.status ?? ''}`;
      try {
        await ctx.prisma.webhookEvent.create({
          data: { provider: 'asaas', eventId, type: body.event, paymentId: body.payment.id },
        });
      } catch (err) {
        if (isUniqueViolation(err)) return res.json({ received: true, duplicate: true });
        throw err;
      }

      const deleted = body.event === 'PAYMENT_DELETED';
      // V1: não confia no corpo — reconsulta o pagamento na API do Asaas (fonte de verdade).
      let pp = fromAsaasPayment(deleted ? { ...body.payment, deleted: true } : body.payment);
      if (!deleted) {
        const provider = await getProvider(ctx).catch(() => null);
        if (provider instanceof AsaasProvider) {
          const fresh = await provider.getPayment(body.payment.id).catch(() => null);
          if (fresh) pp = fresh;
          else
            ctx.logger.warn(
              { paymentId: body.payment.id },
              'reconsulta do pagamento falhou; evento ignorado',
            );
          if (!fresh) return res.json({ received: true, unverified: true });
        }
      }
      await handleProviderPayment(ctx, pp, 'asaas');
    }
    res.json({ received: true });
  });
  return r;
}

/**
 * Fatura simulada (somente com o provedor simulado — desenvolvimento/demonstração).
 * Reproduz o fluxo do webhook do Asaas para testar upgrade, renovação e desbloqueio.
 */
export function simulatedBillingRoutes(ctx: AppContext) {
  const r = Router();
  const ensureSimulated = async () => {
    const provider = await getProvider(ctx);
    if (provider.name !== 'simulated') throw new AppError('NOT_FOUND');
  };
  // V3: exige sessão autenticada; o pagamento simulado só é acessível ao dono da conta (ou master).
  r.use(loadUser(ctx), requireAuth());
  const findOwned = async (req: Request, providerId: string) => {
    const p = await ctx.prisma.payment.findUnique({ where: { providerId } });
    if (!p) throw new AppError('NOT_FOUND');
    if (!req.user!.isMaster && p.accountId !== req.user!.accountId) throw new AppError('NOT_FOUND');
    return p;
  };
  r.get('/:providerId', async (req, res) => {
    await ensureSimulated();
    const p = await findOwned(req, req.params.providerId);
    res.json(toPaymentDto(p));
  });
  r.post('/:providerId/pay', async (req, res) => {
    await ensureSimulated();
    const { billingType } = z
      .object({ billingType: z.enum(['PIX', 'BOLETO', 'CREDIT_CARD']).default('PIX') })
      .parse(req.body ?? {});
    const p = await findOwned(req, req.params.providerId);
    const updated = await handleProviderPayment(
      ctx,
      {
        id: p.providerId!,
        subscriptionId: p.providerSubscriptionId,
        status: 'RECEIVED',
        valueCents: p.amountCents,
        netValueCents: p.netAmountCents,
        dueDate: p.dueDate,
        paidAt: new Date(),
        invoiceUrl: p.invoiceUrl,
        billingType,
      },
      'simulated',
    );
    res.json(updated ? toPaymentDto(updated) : null);
  });
  return r;
}

/** Planos ativos para a landing page (público, sem dados de conta). */
export function publicPlanRoutes(ctx: AppContext) {
  const r = Router();
  r.get('/', rateLimit(ctx, 'public-plans', 120, 60), async (_req, res) => {
    const plans = (await getPlans(ctx)).filter((p) => p.active);
    // Cache curto: os planos são recém-lidos do banco (cache de 5s em memória, limpo ao salvar
    // no painel master), então alterações de preço aparecem na landing em poucos segundos.
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=30');
    res.json({ items: plans.map(toPlanDto) });
  });
  return r;
}
