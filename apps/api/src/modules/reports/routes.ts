import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { audit } from '../../lib/audit';
import { parse } from '../../middleware/validate';
import { requirePermission } from '../auth/middleware';
import { getSettings } from '../settings/service';
import { getSessionForUser, listSessions } from '../sessions/service';
import { toCsv, toXlsx } from './export';
import { buildReport, deleteSessionData } from './service';

const idParam = z.object({ id: z.uuid() });

function fileName(title: string, ext: string) {
  const base = title
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 60);
  return `azhoot-${base || 'relatorio'}-${new Date().toISOString().slice(0, 10)}.${ext}`;
}

export function reportRoutes(ctx: AppContext) {
  const r = Router();
  r.use(requirePermission('presentQuizzes'));

  r.get('/sessions', async (req, res) => {
    const { search } = parse(
      z.object({ search: z.string().trim().max(120).optional() }),
      req.query,
    );
    res.json({ items: await listSessions(ctx, req.user!, { scope: 'all', search }) });
  });

  r.get('/sessions/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json(await buildReport(ctx, req.user!, id));
  });

  r.get('/sessions/:id/export', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { format } = parse(
      z.object({ format: z.enum(['csv', 'xlsx']).default('csv') }),
      req.query,
    );
    const report = await buildReport(ctx, req.user!, id);
    const started = Date.now();
    const buffer = format === 'csv' ? toCsv(report) : await toXlsx(report);
    ctx.metrics.observe('azhoot_export_ms', Date.now() - started, { format });
    await audit(ctx, {
      actorId: req.user!.id,
      action: 'report.exported',
      entityType: 'session',
      entityId: id,
      metadata: { format },
      ip: req.ip,
      requestId: req.id,
    });
    res.setHeader(
      'Content-Type',
      format === 'csv'
        ? 'text/csv; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName(report.session.quizTitle, format)}"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  });

  r.delete('/sessions/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const { mode } = parse(
      z.object({ mode: z.enum(['DELETE', 'ANONYMIZE']).optional() }),
      req.query,
    );
    await getSessionForUser(ctx, req.user!, id, 'control');
    const effective = mode ?? (await getSettings(ctx)).deletionMode;
    await deleteSessionData(ctx, id, effective);
    await audit(ctx, {
      actorId: req.user!.id,
      action: 'report.deleted',
      entityType: 'session',
      entityId: id,
      metadata: { mode: effective },
      ip: req.ip,
      requestId: req.id,
    });
    res.status(204).end();
  });

  return r;
}
