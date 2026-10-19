import { Router } from 'express';
import { userCreateSchema, userUpdateSchema } from '@azhoot/contracts';
import { z } from 'zod';
import type { AppContext } from '../../context';
import { audit } from '../../lib/audit';
import { AppError, isUniqueViolation } from '../../lib/errors';
import { parse } from '../../middleware/validate';
import { requirePermission } from '../auth/middleware';
import { hashPassword, toAuthUser } from '../auth/service';
import { addUserWithinLimit } from '../billing/service';

const idParam = z.object({ id: z.uuid() });

export function userRoutes(ctx: AppContext) {
  const r = Router();
  r.use(requirePermission('manageUsers'));

  const serialize = (u: Awaited<ReturnType<typeof ctx.prisma.user.findFirstOrThrow>>) => ({
    ...toAuthUser(u),
    canViewAllReports: u.canViewAllReports,
    active: u.active,
    createdAt: u.createdAt.toISOString(),
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  });

  r.get('/', async (req, res) => {
    const users = await ctx.prisma.user.findMany({
      where: { accountId: req.user!.accountId },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    res.json({ items: users.map(serialize) });
  });

  r.post('/', async (req, res) => {
    const input = parse(userCreateSchema, req.body);
    try {
      const passwordHash = await hashPassword(input.password);
      const user = await addUserWithinLimit(ctx, req.account!, () =>
        ctx.prisma.user.create({
          data: {
            accountId: req.user!.accountId,
            name: input.name,
            email: input.email,
            role: input.role,
            canViewAllReports: input.canViewAllReports ?? false,
            passwordHash,
          },
        }),
      );
      await audit(ctx, {
        actorId: req.user!.id,
        action: 'user.created',
        entityType: 'user',
        entityId: user.id,
        metadata: { role: user.role },
        ip: req.ip,
        requestId: req.id,
      });
      res.status(201).json(serialize(user));
    } catch (err) {
      if (isUniqueViolation(err, 'email')) throw new AppError('EMAIL_IN_USE');
      throw err;
    }
  });

  r.patch('/:id', async (req, res) => {
    const { id } = parse(idParam, req.params);
    const input = parse(userUpdateSchema, req.body);
    const target = await ctx.prisma.user.findUnique({ where: { id } });
    if (!target || target.accountId !== req.user!.accountId) throw new AppError('NOT_FOUND');
    if (target.role === 'OWNER' || target.id === req.user!.id)
      throw new AppError('CANNOT_MODIFY_SELF');
    const reactivating = input.active === true && !target.active;
    const passwordHash = input.password ? await hashPassword(input.password) : undefined;
    const doUpdate = () =>
      ctx.prisma.user.update({
        where: { id },
        data: {
          name: input.name,
          role: input.role,
          active: input.active,
          canViewAllReports: input.canViewAllReports,
          ...(passwordHash ? { passwordHash, mustChangePassword: false } : {}),
        },
      });
    // V10: reativar consome vaga de usuário — verifica o limite sob o mesmo lock da criação.
    const user = reactivating
      ? await addUserWithinLimit(ctx, req.account!, doUpdate)
      : await doUpdate();
    if (input.active === false || input.password) {
      await ctx.prisma.adminSession.deleteMany({ where: { userId: id } });
    }
    await audit(ctx, {
      actorId: req.user!.id,
      action: 'user.updated',
      entityType: 'user',
      entityId: id,
      metadata: {
        fields: Object.keys(input).filter((k) => k !== 'password'),
        passwordReset: !!input.password,
      },
      ip: req.ip,
      requestId: req.id,
    });
    res.json(serialize(user));
  });

  return r;
}
