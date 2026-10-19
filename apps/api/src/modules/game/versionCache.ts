import type { QuestionType } from '@azhoot/contracts';
import type { AppContext } from '../../context';

export interface CachedOption {
  id: string;
  text: string;
  imageUrl: string | null;
  isCorrect: boolean;
  position: number;
}

export interface CachedQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  imageUrl: string | null;
  durationSeconds: number;
  basePoints: number;
  explanation: string | null;
  position: number;
  options: CachedOption[];
  optionIds: Set<string>;
  correctOptionIds: string[];
}

export interface CachedVersion {
  id: string;
  quizId: string;
  title: string;
  versionNumber: number;
  questions: Map<string, CachedQuestion>;
}

/** Versões publicadas são imutáveis: cache em memória seguro. */
const cache = new Map<string, CachedVersion>();
const MAX = 500;

export async function getVersion(ctx: AppContext, versionId: string): Promise<CachedVersion> {
  const hit = cache.get(versionId);
  if (hit) return hit;
  const v = await ctx.prisma.quizVersion.findUniqueOrThrow({
    where: { id: versionId },
    include: {
      questions: {
        orderBy: { position: 'asc' },
        include: { options: { orderBy: { position: 'asc' } } },
      },
    },
  });
  const version: CachedVersion = {
    id: v.id,
    quizId: v.quizId,
    title: v.title,
    versionNumber: v.versionNumber,
    questions: new Map(
      v.questions.map((q) => [
        q.id,
        {
          id: q.id,
          type: q.type as QuestionType,
          prompt: q.prompt,
          imageUrl: q.imageUrl,
          durationSeconds: q.durationSeconds,
          basePoints: q.type === 'POLL' ? 0 : q.basePoints,
          explanation: q.explanation,
          position: q.position,
          options: q.options.map((o) => ({
            id: o.id,
            text: o.text,
            imageUrl: o.imageUrl,
            isCorrect: q.type === 'POLL' ? false : o.isCorrect,
            position: o.position,
          })),
          optionIds: new Set(q.options.map((o) => o.id)),
          correctOptionIds:
            q.type === 'POLL' ? [] : q.options.filter((o) => o.isCorrect).map((o) => o.id),
        },
      ]),
    ),
  };
  if (v.status === 'PUBLISHED') {
    if (cache.size >= MAX) cache.delete(cache.keys().next().value!);
    cache.set(versionId, version);
  }
  return version;
}
