import { Router } from 'express';
import {
  changePasswordSchema,
  loginSchema,
  signupSchema,
  type MeResponse,
} from '@azhoot/contracts';
import type { AppContext } from '../../context';
import { audit } from '../../lib/audit';
import { AppError, isUniqueViolation } from '../../lib/errors';
import { hit, peek } from '../../lib/rateLimit';
import { rateLimit } from '../../middleware/rateLimit';
import { parse } from '../../middleware/validate';
import { resolveReferral } from '../affiliate/service';
import { getPlan } from '../billing/plans';
import { grantPlanCredits } from '../credits/service';
import { notify } from '../notifications/service';
import { cookieName, requireAuth } from './middleware';
import {
  changePassword,
  createAdminSession,
  destroyAdminSession,
  hashPassword,
  toAuthUser,
  verifyCredentials,
} from './service';

export function authRoutes(ctx: AppContext) {
  const r = Router();

  // Força bruta: só tentativas com falha contam (por e-mail e por IP); logins válidos não bloqueiam.
  r.post('/login', rateLimit(ctx, 'login-ip', 60, 15 * 60), async (req, res) => {
    const input = parse(loginSchema, req.body);
    const ip = req.ip ?? 'unknown';
    const [perEmail, perIp] = await Promise.all([
      peek(ctx.redis, 'login-fail-email', input.email, 10),
      peek(ctx.redis, 'login-fail-ip', ip, 30),
    ]);
    if (!perEmail.allowed || !perIp.allowed)
      throw new AppError('RATE_LIMITED', {
        retryAfterSeconds: Math.max(perEmail.resetSeconds, perIp.resetSeconds),
      });
    const user = await verifyCredentials(ctx, input.email, input.password);
    if (!user) {
      await Promise.all([
        hit(ctx.redis, 'login-fail-email', input.email, 10, 15 * 60),
        hit(ctx.redis, 'login-fail-ip', ip, 30, 15 * 60),
      ]);
      await audit(ctx, {
        action: 'auth.login_failed',
        metadata: { email: input.email },
        ip: req.ip,
        requestId: req.id,
      });
      throw new AppError('INVALID_CREDENTIALS');
    }
    const { token, csrfToken, expiresAt } = await createAdminSession(ctx, user.id, {
      ip: req.ip,
      userAgent: req.header('user-agent'),
    });
    res.cookie(cookieName(ctx), token, {
      httpOnly: true,
      secure: ctx.env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
    await audit(ctx, { actorId: user.id, action: 'auth.login', ip: req.ip, requestId: req.id });
    const body: MeResponse = { user: toAuthUser(user), csrfToken };
    res.json(body);
  });

  /** Cadastro público: cria a conta (plano Gratuito) e o usuário dono, já autenticado. */
  r.post('/signup', rateLimit(ctx, 'signup-ip', 10, 3600), async (req, res) => {
    const input = parse(signupSchema, req.body);
    const referredBy = await resolveReferral(ctx, input.ref, input.email);
    const passwordHash = await hashPassword(input.password);
    let user;
    try {
      user = await ctx.prisma.$transaction(async (tx) => {
        const account = await tx.account.create({
          data: {
            name: input.accountName || input.name,
            planId: 'FREE',
            referredByAccountId: referredBy,
          },
        });
        await tx.subscriptionEvent.create({
          data: { accountId: account.id, type: 'SIGNUP', toPlanId: 'FREE' },
        });
        return tx.user.create({
          data: {
            accountId: account.id,
            name: input.name,
            email: input.email,
            passwordHash,
            role: 'OWNER',
            canViewAllReports: true,
          },
        });
      });
    } catch (err) {
      if (isUniqueViolation(err, 'email')) throw new AppError('EMAIL_IN_USE');
      throw err;
    }
    // Créditos de IA grátis do plano Gratuito (uma vez, na criação da conta).
    const freePlan = await getPlan(ctx, 'FREE');
    if (freePlan?.aiCreditsIncluded && user.accountId)
      await grantPlanCredits(
        ctx,
        user.accountId,
        'FREE',
        freePlan.aiCreditsIncluded,
        `signup:${user.accountId}`,
      );
    const { token, csrfToken, expiresAt } = await createAdminSession(ctx, user.id, {
      ip: req.ip,
      userAgent: req.header('user-agent'),
    });
    res.cookie(cookieName(ctx), token, {
      httpOnly: true,
      secure: ctx.env.COOKIE_SECURE,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });
    await audit(ctx, {
      actorId: user.id,
      action: 'auth.signup',
      metadata: { referred: !!referredBy },
      ip: req.ip,
      requestId: req.id,
    });
    await notify(ctx, user.accountId!, 'welcome', { refKey: user.accountId! });
    const body: MeResponse = { user: toAuthUser(user), csrfToken };
    res.status(201).json(body);
  });

  r.post('/logout', requireAuth(), async (req, res) => {
    await destroyAdminSession(ctx, req.adminSession!.id);
    res.clearCookie(cookieName(ctx), {
      path: '/',
      httpOnly: true,
      secure: ctx.env.COOKIE_SECURE,
      sameSite: 'lax',
    });
    await audit(ctx, {
      actorId: req.user!.id,
      action: 'auth.logout',
      ip: req.ip,
      requestId: req.id,
    });
    res.status(204).end();
  });

  r.get('/me', requireAuth(), (req, res) => {
    const body: MeResponse = { user: req.user!, csrfToken: req.adminSession!.csrfToken };
    res.json(body);
  });

  r.post('/password', requireAuth(), rateLimit(ctx, 'password', 10, 15 * 60), async (req, res) => {
    const input = parse(changePasswordSchema, req.body);
    await changePassword(ctx, req.user!.id, input.currentPassword, input.newPassword);
    // Encerra as demais sessões do usuário.
    await ctx.prisma.adminSession.deleteMany({
      where: { userId: req.user!.id, NOT: { id: req.adminSession!.id } },
    });
    await audit(ctx, {
      actorId: req.user!.id,
      action: 'auth.password_changed',
      ip: req.ip,
      requestId: req.id,
    });
    res.status(204).end();
  });

  return r;
}
