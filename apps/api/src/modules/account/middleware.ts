import type { RequestHandler } from 'express';
import type { AppContext } from '../../context';
import { AppError } from '../../lib/errors';
import { loadAccount } from '../billing/service';

/** Carrega a conta (com plano) do usuário autenticado em `req.account`. */
export function attachAccount(ctx: AppContext): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!req.user?.accountId) return next(new AppError('UNAUTHENTICATED'));
      req.account = await loadAccount(ctx, req.user.accountId);
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireMaster(): RequestHandler {
  return (req, _res, next) => (req.user?.isMaster ? next() : next(new AppError('MASTER_ONLY')));
}

export function requireOwner(): RequestHandler {
  return (req, _res, next) =>
    req.user?.role === 'OWNER' ? next() : next(new AppError('NOT_ACCOUNT_OWNER'));
}
