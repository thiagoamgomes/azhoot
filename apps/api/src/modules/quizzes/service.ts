import { randomUUID } from 'node:crypto';
import {
  normalizeQuestion,
  validateQuizForPublish,
  type QuestionDraft,
  type QuizDraft,
  type QuizListQuery,
  type AuthUser,
  hasPermission,
} from '@azhoot/contracts';
import type { Prisma, PrismaClient } from '@azhoot/db';
import type { AppContext } from '../../context';
import { AppError } from '../../lib/errors';

type Tx = Prisma.TransactionClient | PrismaClient;

const questionInclude = {
  questions: {
    orderBy: { position: 'asc' },
    include: { options: { orderBy: { position: 'asc' } } },
  },
} as const;

export type VersionWithQuestions = Prisma.QuizVersionGetPayload<{
  include: typeof questionInclude;
}>;

export function serializeQuestions(version: VersionWithQuestions | null) {
  return (version?.questions ?? []).map((q) => ({
    id: q.id,
    type: q.type,
    prompt: q.prompt,
    imageUrl: q.imageUrl,
    durationSeconds: q.durationSeconds,
    basePoints: q.basePoints,
    explanation: q.explanation,
    options: q.options.map((o) => ({
      id: o.id,
      text: o.text,
      imageUrl: o.imageUrl,
      isCorrect: o.isCorrect,
    })),
  }));
}

export function toDraft(version: VersionWithQuestions | null): QuestionDraft[] {
  return serializeQuestions(version) as QuestionDraft[];
}

async function getQuizOr404(tx: Tx, id: string) {
  const quiz = await tx.quiz.findUnique({ where: { id } });
  if (!quiz) throw new AppError('NOT_FOUND');
  return quiz;
}

export async function listQuizzes(ctx: AppContext, user: AuthUser, q: QuizListQuery) {
  const canEdit = hasPermission(user.role, 'editQuizzes');
  const where: Prisma.QuizWhereInput = { accountId: user.accountId };
  if (q.search) {
    where.OR = [
      { title: { contains: q.search, mode: 'insensitive' } },
      { category: { contains: q.search, mode: 'insensitive' } },
    ];
  }
  if (!canEdit || q.publishedOnly) {
    where.publishedVersionId = { not: null };
    where.status = 'PUBLISHED';
  } else if (q.status !== 'ALL') {
    where.status = q.status;
  } else {
    where.status = { not: 'ARCHIVED' };
  }
  const orderBy: Prisma.QuizOrderByWithRelationInput =
    q.sort === 'title'
      ? { title: q.order }
      : q.sort === 'createdAt'
        ? { createdAt: q.order }
        : { updatedAt: q.order };

  const quizzes = await ctx.prisma.quiz.findMany({
    where,
    orderBy,
    take: 500,
    include: { owner: { select: { name: true } } },
  });
  const versionIds = quizzes
    .flatMap((z) => [z.currentDraftVersionId, z.publishedVersionId])
    .filter(Boolean) as string[];
  const [counts, versions, sessions] = await Promise.all([
    ctx.prisma.question.groupBy({
      by: ['quizVersionId'],
      where: { quizVersionId: { in: versionIds } },
      _count: true,
    }),
    ctx.prisma.quizVersion.findMany({
      where: { id: { in: versionIds } },
      select: { id: true, versionNumber: true },
    }),
    ctx.prisma.gameSession.groupBy({
      by: ['quizVersionId'],
      where: { quizVersion: { quizId: { in: quizzes.map((z) => z.id) } } },
      _count: true,
    }),
  ]);
  const countBy = new Map(counts.map((c) => [c.quizVersionId, c._count]));
  const versionBy = new Map(versions.map((v) => [v.id, v.versionNumber]));
  const allVersions = await ctx.prisma.quizVersion.findMany({
    where: { id: { in: sessions.map((s) => s.quizVersionId) } },
    select: { id: true, quizId: true },
  });
  const quizOfVersion = new Map(allVersions.map((v) => [v.id, v.quizId]));
  const sessionsBy = new Map<string, number>();
  for (const s of sessions) {
    const quizId = quizOfVersion.get(s.quizVersionId);
    if (quizId) sessionsBy.set(quizId, (sessionsBy.get(quizId) ?? 0) + s._count);
  }

  let items = quizzes.map((z) => {
    const editableVersionId = canEdit
      ? (z.currentDraftVersionId ?? z.publishedVersionId)
      : z.publishedVersionId;
    return {
      id: z.id,
      title: z.title,
      description: z.description,
      category: z.category,
      coverImageUrl: z.coverImageUrl,
      status: z.status,
      hasDraft: !!z.currentDraftVersionId,
      isPublished: !!z.publishedVersionId,
      publishedVersionNumber: z.publishedVersionId
        ? (versionBy.get(z.publishedVersionId) ?? null)
        : null,
      questionCount: editableVersionId ? (countBy.get(editableVersionId) ?? 0) : 0,
      publishedQuestionCount: z.publishedVersionId ? (countBy.get(z.publishedVersionId) ?? 0) : 0,
      sessionCount: sessionsBy.get(z.id) ?? 0,
      ownerName: z.owner.name,
      createdAt: z.createdAt.toISOString(),
      updatedAt: z.updatedAt.toISOString(),
    };
  });
  if (q.sort === 'sessions') {
    items = items.sort((a, b) =>
      q.order === 'asc' ? a.sessionCount - b.sessionCount : b.sessionCount - a.sessionCount,
    );
  }
  return items;
}

/** Garante que o quiz pertence à conta; 404 caso contrário (não revela existência). */
export async function assertQuizInAccount(ctx: AppContext, quizId: string, accountId: string) {
  const q = await ctx.prisma.quiz.findUnique({
    where: { id: quizId },
    select: { accountId: true },
  });
  if (!q || q.accountId !== accountId) throw new AppError('NOT_FOUND');
}

export async function createQuiz(
  ctx: AppContext,
  ownerId: string,
  input: { title: string; description?: string | null; category?: string | null },
  accountId: string,
) {
  return ctx.prisma.$transaction(async (tx) => {
    const quiz = await tx.quiz.create({
      data: {
        accountId,
        ownerId,
        title: input.title,
        description: input.description ?? null,
        category: input.category ?? null,
        status: 'DRAFT',
      },
    });
    const version = await tx.quizVersion.create({
      data: { quizId: quiz.id, versionNumber: 1, status: 'DRAFT', title: quiz.title },
    });
    return tx.quiz.update({ where: { id: quiz.id }, data: { currentDraftVersionId: version.id } });
  });
}

export async function getQuizDetail(ctx: AppContext, user: AuthUser, id: string) {
  const quiz = await getQuizOr404(ctx.prisma, id);
  const canEdit = hasPermission(user.role, 'editQuizzes');
  if (!canEdit && !quiz.publishedVersionId) throw new AppError('NOT_FOUND');
  const versionId = canEdit
    ? (quiz.currentDraftVersionId ?? quiz.publishedVersionId)
    : quiz.publishedVersionId;
  const version = versionId
    ? await ctx.prisma.quizVersion.findUnique({
        where: { id: versionId },
        include: questionInclude,
      })
    : null;
  const published = quiz.publishedVersionId
    ? await ctx.prisma.quizVersion.findUnique({ where: { id: quiz.publishedVersionId } })
    : null;
  const sessionCount = await ctx.prisma.gameSession.count({
    where: { quizVersion: { quizId: id } },
  });
  return {
    id: quiz.id,
    title: quiz.title,
    description: quiz.description,
    category: quiz.category,
    coverImageUrl: quiz.coverImageUrl,
    status: quiz.status,
    hasDraft: !!quiz.currentDraftVersionId,
    isPublished: !!quiz.publishedVersionId,
    editingVersionNumber: version?.versionNumber ?? null,
    publishedVersionNumber: published?.versionNumber ?? null,
    publishedAt: published?.publishedAt?.toISOString() ?? null,
    savedAt: (version?.updatedAt ?? quiz.updatedAt).toISOString(),
    sessionCount,
    canEdit: canEdit && quiz.status !== 'ARCHIVED',
    questions: serializeQuestions(version),
  };
}

/** Substitui todo o conteúdo de um rascunho, preservando IDs pertencentes a ele. */
async function replaceDraftQuestions(
  tx: Prisma.TransactionClient,
  versionId: string,
  questions: QuestionDraft[],
) {
  const existing = await tx.question.findMany({
    where: { quizVersionId: versionId },
    select: { id: true, options: { select: { id: true } } },
  });
  const qIds = new Set(existing.map((q) => q.id));
  const oIds = new Set(existing.flatMap((q) => q.options.map((o) => o.id)));
  await tx.question.deleteMany({ where: { quizVersionId: versionId } });
  const usedQ = new Set<string>();
  const usedO = new Set<string>();
  const pick = (id: string | undefined, pool: Set<string>, used: Set<string>) => {
    const chosen = id && pool.has(id) && !used.has(id) ? id : randomUUID();
    used.add(chosen);
    return chosen;
  };
  for (const [position, raw] of questions.entries()) {
    const q = normalizeQuestion(raw);
    const questionId = pick(q.id, qIds, usedQ);
    await tx.question.create({
      data: {
        id: questionId,
        quizVersionId: versionId,
        position,
        type: q.type,
        prompt: q.prompt,
        imageUrl: q.imageUrl,
        durationSeconds: q.durationSeconds,
        basePoints: q.basePoints,
        explanation: q.explanation,
      },
    });
    if (q.options.length > 0) {
      await tx.option.createMany({
        data: q.options.map((o, i) => ({
          id: pick(o.id, oIds, usedO),
          questionId,
          position: i,
          text: o.text,
          imageUrl: o.imageUrl,
          isCorrect: o.isCorrect,
        })),
      });
    }
  }
}

/** Garante que exista um rascunho editável (cria nova versão a partir da publicada). */
async function ensureDraft(tx: Prisma.TransactionClient, quizId: string) {
  const quiz = await tx.quiz.findUniqueOrThrow({ where: { id: quizId } });
  if (quiz.status === 'ARCHIVED') throw new AppError('QUIZ_ARCHIVED');
  if (quiz.currentDraftVersionId) {
    const v = await tx.quizVersion.findUniqueOrThrow({ where: { id: quiz.currentDraftVersionId } });
    if (v.status !== 'DRAFT') throw new AppError('CONFLICT');
    return v;
  }
  const last = await tx.quizVersion.aggregate({ where: { quizId }, _max: { versionNumber: true } });
  const version = await tx.quizVersion.create({
    data: {
      quizId,
      versionNumber: (last._max.versionNumber ?? 0) + 1,
      status: 'DRAFT',
      title: quiz.title,
    },
  });
  await tx.quiz.update({ where: { id: quizId }, data: { currentDraftVersionId: version.id } });
  return version;
}

export async function saveDraft(ctx: AppContext, quizId: string, draft: QuizDraft) {
  await getQuizOr404(ctx.prisma, quizId);
  const version = await ctx.prisma.$transaction(
    async (tx) => {
      // Serializa gravações concorrentes do mesmo quiz.
      await tx.$executeRaw`SELECT 1 FROM "Quiz" WHERE id = ${quizId}::uuid FOR UPDATE`;
      const v = await ensureDraft(tx, quizId);
      await tx.quiz.update({
        where: { id: quizId },
        data: {
          title: draft.title || 'Quiz sem título',
          description: draft.description,
          category: draft.category,
          coverImageUrl: draft.coverImageUrl,
        },
      });
      await replaceDraftQuestions(tx, v.id, draft.questions);
      return tx.quizVersion.update({
        where: { id: v.id },
        data: { title: draft.title || 'Quiz sem título' },
        include: questionInclude,
      });
    },
    { timeout: 15000 },
  );
  return {
    savedAt: version.updatedAt.toISOString(),
    versionNumber: version.versionNumber,
    questions: serializeQuestions(version),
  };
}

export async function saveQuestionsOnly(
  ctx: AppContext,
  quizId: string,
  questions: QuestionDraft[],
) {
  const quiz = await getQuizOr404(ctx.prisma, quizId);
  return saveDraft(ctx, quizId, {
    title: quiz.title,
    description: quiz.description,
    category: quiz.category,
    coverImageUrl: quiz.coverImageUrl,
    questions,
  });
}

export async function publishQuiz(ctx: AppContext, quizId: string) {
  return ctx.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT 1 FROM "Quiz" WHERE id = ${quizId}::uuid FOR UPDATE`;
    const quiz = await getQuizOr404(tx, quizId);
    if (quiz.status === 'ARCHIVED') throw new AppError('QUIZ_ARCHIVED');
    if (!quiz.currentDraftVersionId) {
      if (quiz.publishedVersionId)
        return { quizId, versionId: quiz.publishedVersionId, alreadyPublished: true };
      throw new AppError('NOT_FOUND');
    }
    const draft = await tx.quizVersion.findUniqueOrThrow({
      where: { id: quiz.currentDraftVersionId },
      include: questionInclude,
    });
    const issues = validateQuizForPublish({ title: quiz.title, questions: toDraft(draft) });
    if (issues.length > 0) throw new AppError('QUIZ_INVALID', { issues });
    await tx.quizVersion.update({
      where: { id: draft.id },
      data: { status: 'PUBLISHED', publishedAt: new Date(), title: quiz.title },
    });
    await tx.quiz.update({
      where: { id: quizId },
      data: { status: 'PUBLISHED', publishedVersionId: draft.id, currentDraftVersionId: null },
    });
    return {
      quizId,
      versionId: draft.id,
      versionNumber: draft.versionNumber,
      alreadyPublished: false,
    };
  });
}

export async function discardDraft(ctx: AppContext, quizId: string) {
  await ctx.prisma.$transaction(async (tx) => {
    const quiz = await getQuizOr404(tx, quizId);
    if (!quiz.currentDraftVersionId || !quiz.publishedVersionId)
      throw new AppError('INVALID_TRANSITION');
    await tx.quiz.update({ where: { id: quizId }, data: { currentDraftVersionId: null } });
    await tx.quizVersion.delete({ where: { id: quiz.currentDraftVersionId } });
  });
}

export async function duplicateQuiz(
  ctx: AppContext,
  quizId: string,
  ownerId: string,
  accountId: string,
) {
  const quiz = await getQuizOr404(ctx.prisma, quizId);
  const sourceId = quiz.currentDraftVersionId ?? quiz.publishedVersionId;
  const source = sourceId
    ? await ctx.prisma.quizVersion.findUnique({ where: { id: sourceId }, include: questionInclude })
    : null;
  const copy = await createQuiz(
    ctx,
    ownerId,
    {
      title: `${quiz.title} (cópia)`.slice(0, 120),
      description: quiz.description,
      category: quiz.category,
    },
    accountId,
  );
  await saveDraft(ctx, copy.id, {
    title: copy.title,
    description: quiz.description,
    category: quiz.category,
    coverImageUrl: quiz.coverImageUrl,
    questions: toDraft(source).map((q) => ({
      ...q,
      id: undefined,
      options: q.options.map((o) => ({ ...o, id: undefined })),
    })),
  });
  return copy;
}

export async function setArchived(ctx: AppContext, quizId: string, archived: boolean) {
  const quiz = await getQuizOr404(ctx.prisma, quizId);
  return ctx.prisma.quiz.update({
    where: { id: quizId },
    data: archived
      ? { status: 'ARCHIVED', archivedAt: new Date() }
      : { status: quiz.publishedVersionId ? 'PUBLISHED' : 'DRAFT', archivedAt: null },
  });
}

export async function deleteQuiz(ctx: AppContext, quizId: string) {
  await getQuizOr404(ctx.prisma, quizId);
  const sessions = await ctx.prisma.gameSession.count({ where: { quizVersion: { quizId } } });
  if (sessions > 0) throw new AppError('QUIZ_IN_USE');
  await ctx.prisma.$transaction([
    ctx.prisma.quiz.update({
      where: { id: quizId },
      data: { currentDraftVersionId: null, publishedVersionId: null },
    }),
    ctx.prisma.quiz.delete({ where: { id: quizId } }),
  ]);
}
