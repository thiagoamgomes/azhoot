import QRCode from 'qrcode';
import {
  hasPermission,
  sessionSettingsSchema,
  type AuthUser,
  type SessionListItem,
  type SessionSettings,
} from '@azhoot/contracts';
import type { GameSession } from '@azhoot/db';
import type { AppContext } from '../../context';
import { generatePin, secureShuffle } from '../../lib/crypto';
import { AppError, isUniqueViolation } from '../../lib/errors';
import { getVersion } from '../game/versionCache';

export const ACTIVE = [
  'LOBBY',
  'COUNTDOWN',
  'QUESTION_OPEN',
  'QUESTION_LOCKED',
  'REVEAL',
  'LEADERBOARD',
] as const;

export function canControl(user: AuthUser, s: Pick<GameSession, 'hostUserId' | 'accountId'>) {
  if (s.accountId !== user.accountId) return false;
  return s.hostUserId === user.id || user.role === 'OWNER';
}

export function canView(user: AuthUser, s: Pick<GameSession, 'hostUserId' | 'accountId'>) {
  if (s.accountId !== user.accountId) return false;
  return canControl(user, s) || user.canViewAllReports;
}

export async function getSessionForUser(
  ctx: AppContext,
  user: AuthUser,
  id: string,
  mode: 'control' | 'view',
) {
  const s = await ctx.prisma.gameSession.findUnique({ where: { id } });
  if (!s || s.accountId !== user.accountId) throw new AppError('SESSION_NOT_FOUND');
  if (!(mode === 'control' ? canControl(user, s) : canView(user, s)))
    throw new AppError('FORBIDDEN');
  return s;
}

/** Gera PIN único entre sessões ativas (índice único parcial garante no banco). */
async function withUniquePin<T>(ctx: AppContext, fn: (pin: string) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const pin = generatePin();
    const clash = await ctx.prisma.gameSession.findFirst({ where: { pin }, select: { id: true } });
    if (clash) continue;
    try {
      return await fn(pin);
    } catch (err) {
      if (
        isUniqueViolation(err) ||
        String((err as Error).message).includes('GameSession_active_pin_key')
      )
        continue;
      throw err;
    }
  }
  throw new AppError('CONFLICT', { reason: 'Não foi possível gerar um PIN único' });
}

export async function createSession(
  ctx: AppContext,
  user: AuthUser,
  quizId: string,
  settings: SessionSettings,
  maxParticipantsLimit = 200,
) {
  if (!hasPermission(user.role, 'presentQuizzes')) throw new AppError('FORBIDDEN');
  const quiz = await ctx.prisma.quiz.findUnique({ where: { id: quizId } });
  if (!quiz || quiz.accountId !== user.accountId) throw new AppError('NOT_FOUND');
  // Limite de participantes por sessão vem do plano da conta
  settings = {
    ...settings,
    maxParticipants: Math.min(settings.maxParticipants, maxParticipantsLimit),
  };
  if (quiz.status === 'ARCHIVED') throw new AppError('QUIZ_ARCHIVED');
  if (!quiz.publishedVersionId) throw new AppError('QUIZ_NOT_PUBLISHED');
  const version = await getVersion(ctx, quiz.publishedVersionId);
  const questions = [...version.questions.values()].sort((a, b) => a.position - b.position);
  if (questions.length === 0) throw new AppError('SESSION_NO_QUESTIONS');
  const order = settings.shuffleQuestions
    ? secureShuffle(questions.map((q) => q.id))
    : questions.map((q) => q.id);
  const optionOrder: Record<string, string[]> = {};
  for (const q of questions) {
    const ids = q.options.map((o) => o.id);
    optionOrder[q.id] =
      settings.shuffleOptions && q.type !== 'TRUE_FALSE' ? secureShuffle(ids) : ids;
  }
  return withUniquePin(ctx, (pin) =>
    ctx.prisma.gameSession.create({
      data: {
        quizVersionId: version.id,
        accountId: user.accountId,
        hostUserId: user.id,
        pin,
        status: 'LOBBY',
        questionOrder: order,
        optionOrder,
        settings,
      },
    }),
  );
}

export async function regeneratePin(ctx: AppContext, sessionId: string) {
  const s = await ctx.prisma.gameSession.findUniqueOrThrow({ where: { id: sessionId } });
  if (s.status !== 'LOBBY') throw new AppError('INVALID_TRANSITION');
  return withUniquePin(ctx, (pin) =>
    ctx.prisma.gameSession.update({
      where: { id: sessionId },
      data: { pin, stateVersion: { increment: 1 } },
    }),
  );
}

export function joinUrl(ctx: AppContext, pin: string) {
  return `${ctx.env.PUBLIC_WEB_URL.replace(/\/$/, '')}/entrar?pin=${pin}`;
}

export async function sessionDetail(ctx: AppContext, s: GameSession) {
  const version = await getVersion(ctx, s.quizVersionId);
  const [participantCount, host] = await Promise.all([
    ctx.prisma.participant.count({
      where: { gameSessionId: s.id, status: { in: ['ACTIVE', 'DISCONNECTED'] } },
    }),
    ctx.prisma.user.findUnique({ where: { id: s.hostUserId }, select: { name: true } }),
  ]);
  const url = s.pin ? joinUrl(ctx, s.pin) : null;
  const qr = url
    ? await QRCode.toString(url, {
        type: 'svg',
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#0F172A', light: '#FFFFFF' },
      })
    : null;
  return {
    id: s.id,
    quizId: version.quizId,
    quizTitle: version.title,
    quizVersionNumber: version.versionNumber,
    hostName: host?.name ?? '',
    status: s.status,
    pin: s.pin,
    joinUrl: url,
    qrSvgDataUri: qr ? `data:image/svg+xml;base64,${Buffer.from(qr).toString('base64')}` : null,
    settings: sessionSettingsSchema.parse(s.settings),
    questionCount: (s.questionOrder as string[]).length,
    participantCount,
    stateVersion: s.stateVersion,
    createdAt: s.createdAt.toISOString(),
    startedAt: s.startedAt?.toISOString() ?? null,
    endedAt: s.endedAt?.toISOString() ?? null,
  };
}

export async function listSessions(
  ctx: AppContext,
  user: AuthUser,
  opts: { scope: 'active' | 'finished' | 'all'; search?: string; take?: number },
): Promise<SessionListItem[]> {
  const where = {
    accountId: user.accountId,
    ...(user.canViewAllReports || user.role === 'OWNER' ? {} : { hostUserId: user.id }),
    ...(opts.scope === 'active'
      ? { status: { in: [...ACTIVE] } }
      : opts.scope === 'finished'
        ? { status: { in: ['FINISHED', 'CANCELLED'] as ('FINISHED' | 'CANCELLED')[] } }
        : {}),
    ...(opts.search
      ? { quizVersion: { title: { contains: opts.search, mode: 'insensitive' as const } } }
      : {}),
  };
  const rows = await ctx.prisma.gameSession.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: opts.take ?? 200,
    include: {
      quizVersion: { select: { title: true, quizId: true } },
      host: { select: { name: true } },
      _count: { select: { participants: true } },
    },
  });
  return rows.map((s) => ({
    id: s.id,
    quizId: s.quizVersion.quizId,
    quizTitle: s.quizVersion.title,
    hostName: s.host.name,
    status: s.status,
    pin: s.pin,
    participantCount: s._count.participants,
    createdAt: s.createdAt.toISOString(),
    startedAt: s.startedAt?.toISOString() ?? null,
    endedAt: s.endedAt?.toISOString() ?? null,
  }));
}
