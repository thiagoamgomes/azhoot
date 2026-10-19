import { Router } from 'express';
import { z } from 'zod';
import { hostCommandPayload, sessionCreateSchema } from '@azhoot/contracts';
import type { AppContext } from '../../context';
import { audit } from '../../lib/audit';
import { parse } from '../../middleware/validate';
import { requirePermission } from '../auth/middleware';
import type { GameEngine, HostCommand } from '../game/engine';
import { assertNotFrozen, maxParticipantsFor } from '../billing/service';
import * as svc from './service';

const idParam = z.object({ id: z.uuid() });
const listQuery = z.object({
  scope: z.enum(['active', 'finished', 'all']).default('all'),
  search: z.string().trim().max(120).optional(),
});

export function sessionRoutes(ctx: AppContext, engine: GameEngine) {
  const r = Router();
  r.use(requirePermission('presentQuizzes'));

  r.get('/', async (req, res) => {
    const q = parse(listQuery, req.query);
    res.json({ items: await svc.listSessions(ctx, req.user!, q) });
  });

  r.post('/', async (req, res) => {
    const input = parse(sessionCreateSchema, req.body);
    assertNotFrozen(req.account!);
    const s = await svc.createSession(
      ctx,
      req.user!,
      input.quizId,
      input.settings,
      maxParticipantsFor(req.account!),
    );
    await audit(ctx, {
      actorId: req.user!.id,
      action: 'session.created',
      entityType: 'session',
      entityId: s.id,
      metadata: { quizId: input.quizId },
      ip: req.ip,
      requestId: req.id,
    });
    res.status(201).json(await svc.sessionDetail(ctx, s));
  });

  r.get('/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const s = await svc.getSessionForUser(ctx, req.user!, id, 'view');
    res.json(await svc.sessionDetail(ctx, s));
  });

  r.post('/:id/regenerate-pin', async (req, res) => {
    const { id } = parse(idParam, req.params);
    await svc.getSessionForUser(ctx, req.user!, id, 'control');
    const s = await svc.regeneratePin(ctx, id);
    await engine.broadcast(id, 'session:snapshot');
    res.json(await svc.sessionDetail(ctx, s));
  });

  const commands: Record<string, HostCommand> = {
    start: 'start',
    lock: 'lock',
    reveal: 'reveal',
    leaderboard: 'leaderboard',
    next: 'next',
    end: 'end',
  };
  for (const [path, command] of Object.entries(commands)) {
    r.post(`/:id/${path}`, async (req, res) => {
      const { id } = parse(idParam, req.params);
      const body = parse(hostCommandPayload, req.body ?? {});
      await svc.getSessionForUser(ctx, req.user!, id, 'control');
      const result = await engine.command(id, command, {
        expectedSeq: body.expectedSeq,
        actorId: req.user!.id,
      });
      if (command === 'start' || command === 'end') {
        await audit(ctx, {
          actorId: req.user!.id,
          action: command === 'start' ? 'session.started' : 'session.ended',
          entityType: 'session',
          entityId: id,
          ip: req.ip,
          requestId: req.id,
        });
      }
      res.json(result);
    });
  }

  r.post('/:id/participants/:participantId/remove', async (req, res) => {
    const { id } = parse(idParam, { id: req.params.id });
    const { participantId } = parse(z.object({ participantId: z.uuid() }), {
      participantId: req.params.participantId,
    });
    const { block } = parse(z.object({ block: z.boolean().default(false) }), req.body ?? {});
    await svc.getSessionForUser(ctx, req.user!, id, 'control');
    await engine.removeParticipant(id, participantId, block, req.user!.id);
    await audit(ctx, {
      actorId: req.user!.id,
      action: 'session.participant_removed',
      entityType: 'session',
      entityId: id,
      metadata: { participantId, block },
      ip: req.ip,
      requestId: req.id,
    });
    res.status(204).end();
  });

  return r;
}
