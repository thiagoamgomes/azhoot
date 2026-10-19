import type { RequestHandler } from 'express';
import { hasPermission, type Permission } from '@azhoot/contracts';
import type { AppContext } from '../../context';
import { safeEqual } from '../../lib/crypto';
import { AppError } from '../../lib/errors';
import { toAuthUser, resolveAdminSession } from './service';

export function cookieName(ctx: AppContext) {
  return ctx.env.COOKIE_SECURE ? '__Host-azh_sid' : 'azh_sid';
}

/** Carrega o usuário a partir do cookie, se houver. Não bloqueia. */
export function loadUser(ctx: AppContext): RequestHandler {
  return async (req, _res, next) => {
    try {
      const token = req.cookies?.[cookieName(ctx)] as string | undefined;
      const session = await resolveAdminSession(ctx, token);
      if (session) {
        req.user = toAuthUser(session.user);
        req.adminSession = { id: session.id, csrfToken: session.csrfToken };
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Exige autenticação e, para métodos que alteram estado, o token CSRF (double submit por header). */
export function requireAuth(): RequestHandler {
  return (req, _res, next) => {
    if (!req.user || !req.adminSession) return next(new AppError('UNAUTHENTICATED'));
    if (!SAFE_METHODS.has(req.method)) {
      const header = req.header('x-csrf-token') ?? '';
      if (!header || !safeEqual(header, req.adminSession.csrfToken)) {
        return next(new AppError('CSRF_INVALID'));
      }
    }
    next();
  };
}

/**
 * Enquanto o usuário precisa trocar a senha (ex.: após reset pelo master), bloqueia ações que
 * alteram estado. Leituras (GET) continuam liberadas para a interface levar até a troca de senha.
 * A troca em si é `/auth/password`, fora do roteador privado.
 */
export function requirePasswordChanged(): RequestHandler {
  return (req, _res, next) => {
    if (req.user?.mustChangePassword && !SAFE_METHODS.has(req.method))
      return next(new AppError('PASSWORD_CHANGE_REQUIRED'));
    next();
  };
}

export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!req.user) return next(new AppError('UNAUTHENTICATED'));
    if (!hasPermission(req.user.role, permission)) return next(new AppError('FORBIDDEN'));
    next();
  };
}

/** Rejeita requisições que alteram estado vindas de origem não autorizada. */
export function originGuard(ctx: AppContext): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.header('origin');
    if (origin && !ctx.env.WEB_ORIGIN.includes(origin)) return next(new AppError('FORBIDDEN'));
    next();
  };
}
