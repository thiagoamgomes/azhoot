import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import {
  questionDraftSchema,
  quizCreateSchema,
  quizDraftSchema,
  quizListQuerySchema,
  LIMITS,
} from '@azhoot/contracts';
import type { AppContext } from '../../context';
import { audit } from '../../lib/audit';
import { parse } from '../../middleware/validate';
import { requirePermission } from '../auth/middleware';
import { assertNotFrozen, createQuizWithinLimit } from '../billing/service';
import * as svc from './service';

const idParam = z.object({ id: z.uuid() });

export function quizRoutes(ctx: AppContext) {
  const r = Router();
  const canEdit = requirePermission('editQuizzes');
  const notFrozen: RequestHandler = (req, _res, next) => {
    try {
      assertNotFrozen(req.account!);
      next();
    } catch (err) {
      next(err);
    }
  };

  // Isolamento por conta em todas as rotas com :id
  r.param('id', async (req, _res, next, id: string) => {
    try {
      if (/^[0-9a-f-]{36}$/i.test(id)) await svc.assertQuizInAccount(ctx, id, req.user!.accountId);
      next();
    } catch (err) {
      next(err);
    }
  });

  r.get('/', async (req, res) => {
    const q = parse(quizListQuerySchema, req.query);
    res.json({ items: await svc.listQuizzes(ctx, req.user!, q) });
  });

  r.post('/', canEdit, async (req, res) => {
    const input = parse(quizCreateSchema, req.body);
    const quiz = await createQuizWithinLimit(ctx, req.account!, () =>
      svc.createQuiz(ctx, req.user!.id, input, req.user!.accountId),
    );
    res.status(201).json(await svc.getQuizDetail(ctx, req.user!, quiz.id));
  });

  r.get('/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    res.json(await svc.getQuizDetail(ctx, req.user!, id));
  });

  /** Autosave do rascunho completo (metadados + perguntas). */
  r.put('/:id', canEdit, notFrozen, async (req, res) => {
    const { id } = parse(idParam, req.params);
    const draft = parse(quizDraftSchema, req.body);
    res.json(await svc.saveDraft(ctx, id, draft));
  });

  r.get('/:id/questions', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const detail = await svc.getQuizDetail(ctx, req.user!, id);
    res.json({ items: detail.questions });
  });

  r.put('/:id/questions', canEdit, notFrozen, async (req, res) => {
    const { id } = parse(idParam, req.params);
    const questions = parse(z.array(questionDraftSchema).max(LIMITS.questionsMax), req.body?.items);
    res.json(await svc.saveQuestionsOnly(ctx, id, questions));
  });

  r.post('/:id/publish', canEdit, notFrozen, async (req, res) => {
    const { id } = parse(idParam, req.params);
    const result = await svc.publishQuiz(ctx, id);
    if (!result.alreadyPublished) {
      await audit(ctx, {
        actorId: req.user!.id,
        action: 'quiz.published',
        entityType: 'quiz',
        entityId: id,
        metadata: { versionId: result.versionId, versionNumber: result.versionNumber },
        ip: req.ip,
        requestId: req.id,
      });
    }
    res.json(await svc.getQuizDetail(ctx, req.user!, id));
  });

  r.post('/:id/discard-draft', canEdit, notFrozen, async (req, res) => {
    const { id } = parse(idParam, req.params);
    await svc.discardDraft(ctx, id);
    res.json(await svc.getQuizDetail(ctx, req.user!, id));
  });

  r.post('/:id/duplicate', canEdit, async (req, res) => {
    const { id } = parse(idParam, req.params);
    const copy = await createQuizWithinLimit(ctx, req.account!, () =>
      svc.duplicateQuiz(ctx, id, req.user!.id, req.user!.accountId),
    );
    res.status(201).json(await svc.getQuizDetail(ctx, req.user!, copy.id));
  });

  r.post('/:id/archive', canEdit, async (req, res) => {
    const { id } = parse(idParam, req.params);
    await svc.setArchived(ctx, id, true);
    await audit(ctx, {
      actorId: req.user!.id,
      action: 'quiz.archived',
      entityType: 'quiz',
      entityId: id,
      ip: req.ip,
      requestId: req.id,
    });
    res.json(await svc.getQuizDetail(ctx, req.user!, id));
  });

  r.post('/:id/unarchive', canEdit, async (req, res) => {
    const { id } = parse(idParam, req.params);
    await createQuizWithinLimit(ctx, req.account!, () => svc.setArchived(ctx, id, false));
    res.json(await svc.getQuizDetail(ctx, req.user!, id));
  });

  r.delete('/:id', canEdit, async (req, res) => {
    const { id } = parse(idParam, req.params);
    await svc.deleteQuiz(ctx, id);
    await audit(ctx, {
      actorId: req.user!.id,
      action: 'quiz.deleted',
      entityType: 'quiz',
      entityId: id,
      ip: req.ip,
      requestId: req.id,
    });
    res.status(204).end();
  });

  return r;
}
