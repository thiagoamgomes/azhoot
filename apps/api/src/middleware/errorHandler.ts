import type { ErrorRequestHandler, RequestHandler } from 'express';
import { MulterError } from 'multer';
import type { AppContext } from '../context';
import { AppError, isAppError } from '../lib/errors';

export function notFoundHandler(): RequestHandler {
  return (_req, _res, next) => next(new AppError('NOT_FOUND'));
}

export function errorHandler(ctx: AppContext): ErrorRequestHandler {
  return (err, req, res, _next) => {
    let appErr: AppError;
    if (isAppError(err)) appErr = err;
    else if (err instanceof MulterError)
      appErr = new AppError('UPLOAD_INVALID', { reason: err.code });
    else if ((err as { type?: string })?.type === 'entity.parse.failed')
      appErr = new AppError('VALIDATION_FAILED', { reason: 'JSON inválido' });
    else if ((err as { type?: string })?.type === 'entity.too.large')
      appErr = new AppError('VALIDATION_FAILED', { reason: 'Payload muito grande' });
    else {
      appErr = new AppError('INTERNAL_ERROR');
      ctx.logger.error({ err, requestId: req.id, path: req.path }, 'erro não tratado');
    }
    ctx.metrics.inc('azhoot_http_errors_total', { code: appErr.code });
    if (res.headersSent) return;
    res.status(appErr.status).json({
      error: {
        code: appErr.code,
        message: appErr.message,
        requestId: req.id,
        details: appErr.details ?? {},
      },
    });
  };
}
