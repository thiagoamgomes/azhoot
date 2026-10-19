import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { AppContext } from './context';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestId } from './middleware/requestId';
import {
  loadUser,
  originGuard,
  requireAuth,
  requirePasswordChanged,
} from './modules/auth/middleware';
import { accountRoutes } from './modules/account/routes';
import { attachAccount, requireMaster } from './modules/account/middleware';
import { authRoutes } from './modules/auth/routes';
import { publicPlanRoutes, simulatedBillingRoutes, webhookRoutes } from './modules/billing/routes';
import { masterRoutes } from './modules/master/routes';
import { dashboardRoutes } from './modules/dashboard/routes';
import type { GameEngine } from './modules/game/engine';
import { healthRoutes } from './modules/health/routes';
import { joinRoutes } from './modules/join/routes';
import { quizRoutes } from './modules/quizzes/routes';
import { reportRoutes } from './modules/reports/routes';
import { sessionRoutes } from './modules/sessions/routes';
import { settingsRoutes } from './modules/settings/routes';
import { uploadRoutes, uploadServeRoutes } from './modules/uploads/routes';
import { userRoutes } from './modules/users/routes';

export function createApp(ctx: AppContext, engine: GameEngine) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', ctx.env.TRUST_PROXY);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger: ctx.logger,
      genReqId: (req) => (req as express.Request).id,
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );
  app.use((req, res, next) => {
    const started = performance.now();
    res.on('finish', () => {
      ctx.metrics.observe('azhoot_http_request_ms', performance.now() - started, {
        method: req.method,
      });
      ctx.metrics.inc('azhoot_http_requests_total', { status: String(res.statusCode) });
    });
    next();
  });
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          imgSrc: ["'self'", 'data:'],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(cors({ origin: ctx.env.WEB_ORIGIN, credentials: true, maxAge: 600 }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/health', healthRoutes(ctx));
  app.get('/metrics', (_req, res) => {
    res.type('text/plain').send(ctx.metrics.render());
  });
  app.use('/uploads', uploadServeRoutes(ctx));

  const api = Router();
  api.use(originGuard(ctx));
  api.use('/health', healthRoutes(ctx));
  api.use('/join', joinRoutes(ctx, engine));
  api.use('/webhooks', webhookRoutes(ctx));
  api.use('/billing/simulated', simulatedBillingRoutes(ctx));
  api.use('/public/plans', publicPlanRoutes(ctx));
  api.use(loadUser(ctx));
  api.use('/auth', authRoutes(ctx));

  const priv = Router();
  priv.use(requireAuth());
  priv.use(attachAccount(ctx));
  priv.use(requirePasswordChanged());
  priv.use('/account', accountRoutes(ctx));
  priv.use('/master', requireMaster(), masterRoutes(ctx));
  priv.use('/dashboard', dashboardRoutes(ctx));
  priv.use('/users', userRoutes(ctx));
  priv.use('/settings', settingsRoutes(ctx));
  priv.use('/quizzes', quizRoutes(ctx));
  priv.use('/uploads', uploadRoutes(ctx));
  priv.use('/sessions', sessionRoutes(ctx, engine));
  priv.use('/reports', reportRoutes(ctx));
  api.use(priv);

  app.use('/api/v1', api);
  app.use(notFoundHandler());
  app.use(errorHandler(ctx));
  return app;
}
