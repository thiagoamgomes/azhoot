import type { QuestionType } from '@azhoot/contracts';

/** Pontuação conforme docs/specs/realtime.md. */
export function computeScore(params: {
  basePoints: number;
  isCorrect: boolean;
  openedAt: number;
  closesAt: number;
  receivedAt: number;
}): number {
  const { basePoints, isCorrect, openedAt, closesAt, receivedAt } = params;
  if (!isCorrect || basePoints <= 0) return 0;
  const durationMs = closesAt - openedAt;
  if (durationMs <= 0) return 0;
  const remainingRatio = Math.min(1, Math.max(0, (closesAt - receivedAt) / durationMs));
  return Math.round(basePoints * (0.5 + 0.5 * remainingRatio));
}

/** Correção: conjunto exato de alternativas corretas. Enquete retorna null (sem correção). */
export function evaluateAnswer(
  type: QuestionType,
  correctOptionIds: readonly string[],
  selectedOptionIds: readonly string[],
): boolean | null {
  if (type === 'POLL') return null;
  const selected = new Set(selectedOptionIds);
  if (selected.size !== selectedOptionIds.length) return false;
  if (type !== 'MULTIPLE_CHOICE' && selected.size !== 1) return false;
  const correct = new Set(correctOptionIds);
  return selected.size === correct.size && [...selected].every((id) => correct.has(id));
}

export interface RankInput {
  id: string;
  totalScore: number;
  correctCount: number;
  totalResponseTimeMs: number;
}

/**
 * Ranking: maior total, depois mais acertos, depois menor soma de tempos (respostas corretas).
 * Empate completo compartilha a mesma posição (ranking "1224").
 */
export function rankParticipants<T extends RankInput>(
  items: readonly T[],
): (T & { rank: number })[] {
  const sorted = [...items].sort(
    (a, b) =>
      b.totalScore - a.totalScore ||
      b.correctCount - a.correctCount ||
      a.totalResponseTimeMs - b.totalResponseTimeMs,
  );
  const out: (T & { rank: number })[] = [];
  sorted.forEach((p, i) => {
    const prev = out[i - 1];
    const tie =
      prev &&
      prev.totalScore === p.totalScore &&
      prev.correctCount === p.correctCount &&
      prev.totalResponseTimeMs === p.totalResponseTimeMs;
    out.push({ ...p, rank: tie ? prev.rank : i + 1 });
  });
  return out;
}
