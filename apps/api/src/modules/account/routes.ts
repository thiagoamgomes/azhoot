import { Router } from 'express';
import multer from 'multer';
import { MAX_AI_ATTACHMENT_MB, MAX_AI_ATTACHMENTS } from '@azhoot/contracts';
import { z } from 'zod';
import {
  cancelPlanSchema,
  changePlanSchema,
  checkoutSchema,
  deleteAccountSchema,
  pixSchema,
  type NotificationDto,
} from '@azhoot/contracts';
import type { AppContext } from '../../context';
import { audit } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { rateLimit } from '../../middleware/rateLimit';
import { parse } from '../../middleware/validate';
import { generateQuestionsSchema } from '@azhoot/contracts';
import { affiliateOverview } from '../affiliate/service';
import { cookieName, requirePermission } from '../auth/middleware';
import { getPlan } from '../billing/plans';
import * as billing from '../billing/service';
import * as credits from '../credits/service';
import * as ai from '../ai/service';
import { requireOwner } from './middleware';

export function accountRoutes(ctx: AppContext) {
  const r = Router();

  // Anexos da geração com IA: em memória, limitados por tamanho e quantidade.
  const aiUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_AI_ATTACHMENT_MB * 1024 * 1024, files: MAX_AI_ATTACHMENTS },
  });

  /** Visão do plano, uso, faturas e planos disponíveis. */
  r.get('/billing', async (req, res) => {
    res.json(await billing.getOverview(ctx, req.account!, req.user!));
  });

  r.get('/payments', async (req, res) => {
    const items = await ctx.prisma.payment.findMany({
      where: { accountId: req.account!.id },
      orderBy: { dueDate: 'desc' },
      take: 100,
    });
    res.json({ items: items.map(billing.toPaymentDto) });
  });

  /** Quizzes e usuários para a seleção do que excluir num downgrade/cancelamento. */
  r.get('/removal-candidates', requireOwner(), async (req, res) => {
    const [quizzes, users] = await Promise.all([
      ctx.prisma.quiz.findMany({
        where: { accountId: req.account!.id, status: { not: 'ARCHIVED' } },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          title: true,
          status: true,
          updatedAt: true,
          _count: { select: { versions: true } },
        },
      }),
      ctx.prisma.user.findMany({
        where: { accountId: req.account!.id, active: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, email: true, role: true, lastLoginAt: true },
      }),
    ]);
    const sessions = await ctx.prisma.gameSession.groupBy({
      by: ['quizVersionId'],
      where: { accountId: req.account!.id },
      _count: true,
    });
    const versions = await ctx.prisma.quizVersion.findMany({
      where: { id: { in: sessions.map((s) => s.quizVersionId) } },
      select: { id: true, quizId: true },
    });
    const byQuiz = new Map<string, number>();
    for (const s of sessions) {
      const q = versions.find((v) => v.id === s.quizVersionId)?.quizId;
      if (q) byQuiz.set(q, (byQuiz.get(q) ?? 0) + s._count);
    }
    res.json({
      quizzes: quizzes.map((q) => ({
        id: q.id,
        title: q.title,
        status: q.status,
        updatedAt: q.updatedAt.toISOString(),
        sessions: byQuiz.get(q.id) ?? 0,
      })),
      users: users.map((u) => ({ ...u, lastLoginAt: u.lastLoginAt?.toISOString() ?? null })),
    });
  });

  /** Upgrade: cria a assinatura e devolve a fatura (PIX, boleto ou cartão). */
  r.post(
    '/checkout',
    requireOwner(),
    rateLimit(ctx, 'checkout', 20, 3600, (req) => req.user!.accountId),
    async (req, res) => {
      const input = parse(checkoutSchema, req.body);
      const result = await billing.checkout(ctx, req.account!, input, req.user!);
      await audit(ctx, {
        actorId: req.user!.id,
        action: 'billing.checkout',
        entityType: 'account',
        entityId: req.account!.id,
        metadata: { planId: input.planId },
        ip: req.ip,
        requestId: req.id,
      });
      res.status(201).json(result);
    },
  );

  /** Downgrade (ou troca para plano inferior) agendado para a renovação. */
  r.post('/plan', requireOwner(), async (req, res) => {
    const input = parse(changePlanSchema, req.body);
    const result = await billing.scheduleChange(ctx, req.account!, input.planId, input);
    await audit(ctx, {
      actorId: req.user!.id,
      action: 'billing.plan_change',
      entityType: 'account',
      entityId: req.account!.id,
      metadata: { planId: input.planId, ...result },
      ip: req.ip,
      requestId: req.id,
    });
    res.json(result);
  });

  /** Cancela o plano pago: volta ao Gratuito na renovação (ou já, se congelada). */
  r.post('/cancel', requireOwner(), async (req, res) => {
    const input = parse(cancelPlanSchema, req.body);
    if (req.account!.planId === 'FREE') throw new AppError('NO_ACTIVE_SUBSCRIPTION');
    const result = await billing.scheduleChange(ctx, req.account!, 'FREE', input);
    await audit(ctx, {
      actorId: req.user!.id,
      action: 'billing.cancel',
      entityType: 'account',
      entityId: req.account!.id,
      metadata: { reason: input.reason ?? null, ...result },
      ip: req.ip,
      requestId: req.id,
    });
    res.json(result);
  });

  r.post('/plan/revert', requireOwner(), async (req, res) => {
    await billing.revertScheduledChange(ctx, req.account!);
    res.json(
      await billing.getOverview(ctx, await billing.loadAccount(ctx, req.account!.id), req.user!),
    );
  });

  /** Checa quantos itens precisam ser removidos para caber num plano (prévia do downgrade). */
  r.post('/plan/preview', requireOwner(), async (req, res) => {
    const input = parse(changePlanSchema, req.body);
    const target = await getPlan(ctx, input.planId);
    if (!target) throw new AppError('PLAN_INVALID');
    res.json(await billing.removalShortfall(ctx, req.account!, target, input));
  });

  /* ---------------------------- notificações ---------------------------- */

  r.get('/notifications', async (req, res) => {
    const items = await ctx.prisma.notification.findMany({
      where: { accountId: req.account!.id, OR: [{ userId: null }, { userId: req.user!.id }] },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const unread = await ctx.prisma.notification.count({
      where: {
        accountId: req.account!.id,
        readAt: null,
        OR: [{ userId: null }, { userId: req.user!.id }],
      },
    });
    const body: { items: NotificationDto[]; unread: number } = {
      unread,
      items: items.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        link: n.link,
        readAt: n.readAt?.toISOString() ?? null,
        createdAt: n.createdAt.toISOString(),
      })),
    };
    res.json(body);
  });

  r.post('/notifications/read', async (req, res) => {
    const { ids } = parse(z.object({ ids: z.array(z.uuid()).max(200).optional() }), req.body ?? {});
    await ctx.prisma.notification.updateMany({
      where: {
        accountId: req.account!.id,
        readAt: null,
        OR: [{ userId: null }, { userId: req.user!.id }],
        ...(ids ? { id: { in: ids } } : {}),
      },
      data: { readAt: new Date() },
    });
    res.status(204).end();
  });

  /* ------------------------------- afiliado ------------------------------ */

  r.get('/affiliate', requireOwner(), async (req, res) => {
    res.json(await affiliateOverview(ctx, req.account!.id));
  });

  r.put('/affiliate/pix', requireOwner(), async (req, res) => {
    if (!req.account!.affiliateEnabled) throw new AppError('AFFILIATE_DISABLED');
    const input = parse(pixSchema, req.body);
    await ctx.prisma.account.update({
      where: { id: req.account!.id },
      data: { pixKeyType: input.pixKeyType, pixKey: input.pixKey },
    });
    res.json(await affiliateOverview(ctx, req.account!.id));
  });

  /* ---------------------------- excluir conta ---------------------------- */

  r.get('/deletion-summary', requireOwner(), async (req, res) => {
    const id = req.account!.id;
    const [quizzes, sessions, users, participants] = await Promise.all([
      ctx.prisma.quiz.count({ where: { accountId: id } }),
      ctx.prisma.gameSession.count({ where: { accountId: id } }),
      ctx.prisma.user.count({ where: { accountId: id } }),
      ctx.prisma.participant.count({ where: { gameSession: { accountId: id } } }),
    ]);
    res.json({
      quizzes,
      sessions,
      users,
      participants,
      planId: req.account!.planId,
      currentPeriodEnd: req.account!.currentPeriodEnd?.toISOString() ?? null,
    });
  });

  r.delete(
    '/',
    requireOwner(),
    rateLimit(ctx, 'account-delete', 10, 3600, (req) => req.user!.id),
    async (req, res) => {
      const input = parse(deleteAccountSchema, req.body);
      await billing.deleteAccount(ctx, req.account!, req.user!, input.password);
      await audit(ctx, {
        actorId: null,
        action: 'account.deleted',
        entityType: 'account',
        entityId: req.account!.id,
        ip: req.ip,
        requestId: req.id,
      });
      res.clearCookie(cookieName(ctx), {
        path: '/',
        httpOnly: true,
        secure: ctx.env.COOKIE_SECURE,
        sameSite: 'lax',
      });
      res.status(204).end();
    },
  );

  /* --------------------------- créditos de IA ---------------------------- */

  r.get('/credits', async (req, res) => {
    res.json(await credits.overview(ctx, req.account!.id));
  });

  /** Compra de um pacote de créditos (cobrança avulsa). */
  r.post(
    '/credits/packs/:id/checkout',
    requireOwner(),
    rateLimit(ctx, 'credit-checkout', 20, 3600, (req) => req.user!.accountId),
    async (req, res) => {
      const { id } = parse(z.object({ id: z.uuid() }), req.params);
      const input = parse(
        z.object({
          billingName: z.string().trim().max(120).optional(),
          billingDocument: z.string().trim().max(20).optional(),
          billingEmail: z.email().optional(),
          billingPhone: z.string().trim().max(20).optional(),
        }),
        req.body ?? {},
      );
      const result = await credits.checkoutPack(ctx, req.account!, id, input, req.user!.email);
      await audit(ctx, {
        actorId: req.user!.id,
        action: 'billing.checkout',
        entityType: 'account',
        entityId: req.account!.id,
        metadata: { creditPackId: id },
        ip: req.ip,
        requestId: req.id,
      });
      res.status(201).json(result);
    },
  );

  /** Geração de perguntas com IA (1 crédito só com texto, 2 com anexos). */
  r.post(
    '/ai/generate',
    requirePermission('editQuizzes'),
    rateLimit(ctx, 'ai-generate', 30, 3600, (req) => req.user!.accountId),
    aiUpload.array('files', MAX_AI_ATTACHMENTS),
    async (req, res) => {
      const input = parse(generateQuestionsSchema, req.body);
      const files = (req.files as Express.Multer.File[] | undefined) ?? [];
      const result = await ai.generate(
        ctx,
        req.account!,
        req.user!,
        {
          theme: input.theme,
          level: input.level,
          content: input.content,
          count: input.count,
          type: input.type ?? 'VARIED',
        },
        files.map((f) => ({
          originalname: f.originalname,
          mimetype: f.mimetype,
          buffer: f.buffer,
          size: f.size,
        })),
      );
      await audit(ctx, {
        actorId: req.user!.id,
        action: 'ai.generate',
        entityType: 'account',
        entityId: req.account!.id,
        metadata: { type: input.type, count: result.questions.length, files: files.length },
        ip: req.ip,
        requestId: req.id,
      });
      res.json(result);
    },
  );

  return r;
}
