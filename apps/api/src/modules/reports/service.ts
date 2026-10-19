import type {
  AuthUser,
  ReportParticipantRow,
  ReportQuestionRow,
  SessionReport,
} from '@azhoot/contracts';
import type { AppContext } from '../../context';
import { AppError } from '../../lib/errors';
import { rankParticipants } from '../game/scoring';
import { getVersion } from '../game/versionCache';
import { getSessionForUser } from '../sessions/service';

const avg = (xs: number[]) =>
  xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;

export async function buildReport(
  ctx: AppContext,
  user: AuthUser,
  sessionId: string,
): Promise<SessionReport> {
  const s = await getSessionForUser(ctx, user, sessionId, 'view');
  const [version, host, participants, answers] = await Promise.all([
    getVersion(ctx, s.quizVersionId),
    ctx.prisma.user.findUnique({ where: { id: s.hostUserId }, select: { name: true } }),
    ctx.prisma.participant.findMany({
      where: { gameSessionId: s.id },
      orderBy: { joinedAt: 'asc' },
    }),
    ctx.prisma.answer.findMany({ where: { gameSessionId: s.id }, orderBy: { receivedAt: 'asc' } }),
  ]);

  const order = (s.questionOrder as string[]).filter((id) => version.questions.has(id));
  const ranked = rankParticipants(
    participants.filter((p) => p.status !== 'REMOVED' && p.status !== 'BLOCKED'),
  );
  const rankOf = new Map(ranked.map((p) => [p.id, p.finalRank ?? p.rank]));
  const answersBy = new Map<string, typeof answers>();
  for (const a of answers) {
    const arr = answersBy.get(a.participantId) ?? [];
    arr.push(a);
    answersBy.set(a.participantId, arr);
  }

  const participantRows: ReportParticipantRow[] = participants
    .map((p) => {
      const mine = answersBy.get(p.id) ?? [];
      return {
        participantId: p.id,
        rank: rankOf.get(p.id) ?? 0,
        nickname: p.nickname,
        totalScore: p.totalScore,
        correctCount: p.correctCount,
        answeredCount: mine.length,
        averageResponseMs: avg(mine.map((a) => a.responseTimeMs)),
        status: p.status,
      };
    })
    .sort(
      (a, b) => (a.rank || 1e9) - (b.rank || 1e9) || a.nickname.localeCompare(b.nickname, 'pt-BR'),
    );

  const questionRows: ReportQuestionRow[] = order.map((qid, position) => {
    const q = version.questions.get(qid)!;
    const qa = answers.filter((a) => a.questionId === qid);
    const counts = new Map<string, number>();
    for (const a of qa)
      for (const o of a.selectedOptionIds) counts.set(o, (counts.get(o) ?? 0) + 1);
    const scored = q.type !== 'POLL';
    const correct = qa.filter((a) => a.isCorrect).length;
    const optOrder = (s.optionOrder as Record<string, string[]>)[qid] ?? q.options.map((o) => o.id);
    const byId = new Map(q.options.map((o) => [o.id, o]));
    return {
      questionId: qid,
      position,
      type: q.type,
      prompt: q.prompt,
      basePoints: q.basePoints,
      totalAnswers: qa.length,
      correctAnswers: correct,
      accuracy: scored && qa.length ? correct / qa.length : null,
      averageResponseMs: avg(qa.map((a) => a.responseTimeMs)),
      options: optOrder
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map((o) => ({
          optionId: o!.id,
          text: o!.text,
          isCorrect: o!.isCorrect,
          count: counts.get(o!.id) ?? 0,
        })),
    };
  });

  const scoredQuestions = questionRows.filter((q) => q.accuracy !== null);
  const sortedByAcc = [...scoredQuestions].sort((a, b) => a.accuracy! - b.accuracy!);
  const scoredAnswers = answers.filter((a) => a.isCorrect !== null);

  return {
    session: {
      id: s.id,
      quizId: version.quizId,
      quizTitle: version.title,
      quizVersionNumber: version.versionNumber,
      hostName: host?.name ?? '',
      status: s.status,
      pin: s.pin,
      participantCount: participants.length,
      createdAt: s.createdAt.toISOString(),
      startedAt: s.startedAt?.toISOString() ?? null,
      endedAt: s.endedAt?.toISOString() ?? null,
    },
    summary: {
      participants: participants.length,
      answers: answers.length,
      averageAccuracy: scoredAnswers.length
        ? scoredAnswers.filter((a) => a.isCorrect).length / scoredAnswers.length
        : null,
      averageResponseMs: avg(answers.map((a) => a.responseTimeMs)),
      hardestQuestionId: sortedByAcc[0]?.questionId ?? null,
      easiestQuestionId: sortedByAcc.at(-1)?.questionId ?? null,
    },
    participants: participantRows,
    questions: questionRows,
    answers: answers.map((a) => ({
      participantId: a.participantId,
      questionId: a.questionId,
      selectedOptionIds: a.selectedOptionIds,
      isCorrect: a.isCorrect,
      scoreAwarded: a.scoreAwarded,
      responseTimeMs: a.responseTimeMs,
    })),
  };
}

/** Exclui ou anonimiza os dados de participantes de uma sessão encerrada. */
export async function deleteSessionData(
  ctx: AppContext,
  sessionId: string,
  mode: 'DELETE' | 'ANONYMIZE',
) {
  const s = await ctx.prisma.gameSession.findUnique({ where: { id: sessionId } });
  if (!s) throw new AppError('SESSION_NOT_FOUND');
  if (s.status !== 'FINISHED' && s.status !== 'CANCELLED') throw new AppError('INVALID_TRANSITION');
  if (mode === 'DELETE') {
    await ctx.prisma.gameSession.delete({ where: { id: sessionId } });
    return;
  }
  const participants = await ctx.prisma.participant.findMany({
    where: { gameSessionId: sessionId },
    select: { id: true },
    orderBy: { joinedAt: 'asc' },
  });
  await ctx.prisma.$transaction([
    ...participants.map((p, i) =>
      ctx.prisma.participant.update({
        where: { id: p.id },
        data: {
          nickname: `Participante ${i + 1}`,
          normalizedNickname: `anon-${p.id}`,
          sessionTokenHash: `anon-${p.id}`,
        },
      }),
    ),
    ctx.prisma.sessionBan.deleteMany({ where: { gameSessionId: sessionId } }),
    ctx.prisma.gameSession.update({ where: { id: sessionId }, data: { anonymizedAt: new Date() } }),
  ]);
}

/** Aplica a política de retenção configurada (0 = manter indefinidamente). */
export async function applyRetention(
  ctx: AppContext,
  retentionDays: number,
  mode: 'DELETE' | 'ANONYMIZE',
) {
  if (retentionDays <= 0) return 0;
  const cutoff = new Date(Date.now() - retentionDays * 86400_000);
  const old = await ctx.prisma.gameSession.findMany({
    where: {
      status: { in: ['FINISHED', 'CANCELLED'] },
      endedAt: { lt: cutoff },
      ...(mode === 'ANONYMIZE' ? { anonymizedAt: null } : {}),
    },
    select: { id: true },
    take: 200,
  });
  for (const { id } of old) await deleteSessionData(ctx, id, mode);
  return old.length;
}
