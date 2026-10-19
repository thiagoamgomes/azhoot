import { Router } from 'express';
import type { DashboardStats } from '@azhoot/contracts';
import type { AppContext } from '../../context';
import { listSessions } from '../sessions/service';

export function dashboardRoutes(ctx: AppContext) {
  const r = Router();
  r.get('/', async (req, res) => {
    const user = req.user!;
    const all = user.role === 'OWNER' || user.canViewAllReports;
    const sessionWhere = all
      ? { accountId: user.accountId }
      : { accountId: user.accountId, hostUserId: user.id };
    const [quizzes, sessions, participants, answers, correct, scoredAnswers, recentSessions, top] =
      await Promise.all([
        ctx.prisma.quiz.count({
          where: { accountId: user.accountId, status: { not: 'ARCHIVED' } },
        }),
        ctx.prisma.gameSession.count({ where: sessionWhere }),
        ctx.prisma.participant.count({ where: { gameSession: sessionWhere } }),
        ctx.prisma.answer.count({ where: { gameSession: sessionWhere } }),
        ctx.prisma.answer.count({ where: { gameSession: sessionWhere, isCorrect: true } }),
        ctx.prisma.answer.count({ where: { gameSession: sessionWhere, isCorrect: { not: null } } }),
        listSessions(ctx, user, { scope: 'all', take: 6 }),
        ctx.prisma.gameSession.groupBy({
          by: ['quizVersionId'],
          where: sessionWhere,
          _count: true,
        }),
      ]);
    const versions = await ctx.prisma.quizVersion.findMany({
      where: { id: { in: top.map((t) => t.quizVersionId) } },
      select: { id: true, quizId: true, quiz: { select: { title: true } } },
    });
    const byQuiz = new Map<string, { quizId: string; title: string; sessions: number }>();
    for (const t of top) {
      const v = versions.find((x) => x.id === t.quizVersionId);
      if (!v) continue;
      const cur = byQuiz.get(v.quizId) ?? { quizId: v.quizId, title: v.quiz.title, sessions: 0 };
      cur.sessions += t._count;
      byQuiz.set(v.quizId, cur);
    }
    const body: DashboardStats = {
      totals: { quizzes, sessions, participants, answers },
      averageAccuracy: scoredAnswers ? correct / scoredAnswers : null,
      recentSessions,
      topQuizzes: [...byQuiz.values()].sort((a, b) => b.sessions - a.sessions).slice(0, 5),
    };
    res.json(body);
  });
  return r;
}
