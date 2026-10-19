import argon2 from 'argon2';
import type { AuthUser, UserRole } from '@azhoot/contracts';
import type { User } from '@azhoot/db';
import type { AppContext } from '../../context';
import { hashToken, randomToken } from '../../lib/crypto';
import { AppError } from '../../lib/errors';

export const ARGON_OPTIONS = {
  type: argon2.argon2id as 0 | 1 | 2,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

// Hash fixo para igualar o tempo de resposta quando o e-mail não existe.
let dummyHash: Promise<string> | undefined;

export function hashPassword(password: string) {
  return argon2.hash(password, ARGON_OPTIONS);
}

export function toAuthUser(u: User): AuthUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role as UserRole,
    canViewAllReports: u.role === 'OWNER' || u.canViewAllReports,
    isMaster: u.isMaster,
    accountId: u.accountId ?? '',
    mustChangePassword: u.mustChangePassword,
  };
}

export async function verifyCredentials(ctx: AppContext, email: string, password: string) {
  const user = await ctx.prisma.user.findUnique({
    where: { email },
    include: { account: { select: { active: true } } },
  });
  if (
    !user ||
    !user.active ||
    !user.accountId ||
    (!user.isMaster && user.account?.active === false)
  ) {
    dummyHash ??= argon2.hash('dummy-password-for-timing', ARGON_OPTIONS);
    await argon2.verify(await dummyHash, password).catch(() => false);
    return null;
  }
  const ok = await argon2.verify(user.passwordHash, password).catch(() => false);
  return ok ? user : null;
}

export async function createAdminSession(
  ctx: AppContext,
  userId: string,
  meta: { ip?: string; userAgent?: string },
) {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + ctx.env.ADMIN_SESSION_TTL_HOURS * 3600_000);
  await ctx.prisma.adminSession.create({
    data: {
      tokenHash: hashToken(token, ctx.env.SESSION_SECRET),
      csrfToken,
      userId,
      ip: meta.ip ?? null,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      expiresAt,
    },
  });
  await ctx.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  return { token, csrfToken, expiresAt };
}

/** Resolve o cookie de sessão administrativa. Retorna null se inválido/expirado. */
export async function resolveAdminSession(ctx: AppContext, token: string | undefined) {
  if (!token || token.length > 200) return null;
  const session = await ctx.prisma.adminSession.findUnique({
    where: { tokenHash: hashToken(token, ctx.env.SESSION_SECRET) },
    include: { user: { include: { account: { select: { active: true } } } } },
  });
  if (!session) return null;
  if (
    session.expiresAt < new Date() ||
    !session.user.active ||
    (!session.user.isMaster && session.user.account?.active === false)
  ) {
    await ctx.prisma.adminSession.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
    await ctx.prisma.adminSession
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  }
  return session;
}

export async function destroyAdminSession(ctx: AppContext, sessionId: string) {
  await ctx.prisma.adminSession.deleteMany({ where: { id: sessionId } });
}

export async function changePassword(
  ctx: AppContext,
  userId: string,
  current: string,
  next: string,
) {
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const ok = await argon2.verify(user.passwordHash, current).catch(() => false);
  if (!ok) throw new AppError('INVALID_CREDENTIALS');
  await ctx.prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await hashPassword(next), mustChangePassword: false },
  });
}
