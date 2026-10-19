import type {
  HostParticipant,
  LeaderboardEntry,
  MeState,
  OpenQuestion,
  PublicQuestion,
  RevealData,
  SessionSnapshot,
} from '@azhoot/contracts';
import { rankParticipants } from './scoring';
import { currentQuestionId, type ParsedSession } from './sessionState';
import type { CachedQuestion, CachedVersion } from './versionCache';

export interface ViewParticipant {
  id: string;
  nickname: string;
  status: HostParticipant['status'];
  totalScore: number;
  correctCount: number;
  totalResponseTimeMs: number;
}

export interface ViewAnswer {
  participantId: string;
  clientAnswerId: string;
  selectedOptionIds: string[];
  isCorrect: boolean | null;
  scoreAwarded: number;
  responseTimeMs: number;
}

/** Tudo o que é necessário para montar snapshots de qualquer perfil, carregado uma única vez. */
export interface SessionView {
  session: ParsedSession;
  version: CachedVersion;
  participants: ViewParticipant[];
  /** Respostas da pergunta atual. */
  answers: ViewAnswer[];
}

const LEADERBOARD_SIZE = 10;

export function currentQuestion(view: SessionView): CachedQuestion | null {
  const id = currentQuestionId(view.session);
  return id ? (view.version.questions.get(id) ?? null) : null;
}

/** Projeção pública da pergunta: NUNCA inclui isCorrect nem explicação. */
export function toPublicQuestion(view: SessionView, q: CachedQuestion): PublicQuestion {
  const order = view.session.optionOrder[q.id];
  const byId = new Map(q.options.map((o) => [o.id, o]));
  const options = (
    order && order.length === q.options.length ? order.map((id) => byId.get(id)!) : q.options
  ).map((o) => ({ id: o.id, text: o.text, imageUrl: o.imageUrl }));
  return {
    id: q.id,
    index: view.session.currentIndex ?? 0,
    total: view.session.questionOrder.length,
    type: q.type,
    prompt: q.prompt,
    imageUrl: q.imageUrl,
    durationSeconds: q.durationSeconds,
    basePoints: q.basePoints,
    options,
  };
}

export function buildReveal(view: SessionView, q: CachedQuestion): RevealData {
  const counts = new Map<string, number>(q.options.map((o) => [o.id, 0]));
  let correctAnswers = 0;
  for (const a of view.answers) {
    for (const id of a.selectedOptionIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    if (a.isCorrect) correctAnswers++;
  }
  const order = view.session.optionOrder[q.id] ?? q.options.map((o) => o.id);
  return {
    questionId: q.id,
    correctOptionIds: q.correctOptionIds,
    distribution: order.map((optionId) => ({ optionId, count: counts.get(optionId) ?? 0 })),
    totalAnswers: view.answers.length,
    correctAnswers,
    explanation: q.explanation,
  };
}

/**
 * Participantes com totais "até a última revelação": enquanto a pergunta está aberta/bloqueada,
 * a pontuação da pergunta atual é descontada para não vazar a correção via ranking.
 */
export function effectiveParticipants(view: SessionView): ViewParticipant[] {
  const hidden =
    view.session.status === 'QUESTION_OPEN' || view.session.status === 'QUESTION_LOCKED';
  const answers = new Map(view.answers.map((a) => [a.participantId, a]));
  return view.participants
    .filter((p) => p.status === 'ACTIVE' || p.status === 'DISCONNECTED')
    .map((p) => {
      const a = hidden ? answers.get(p.id) : undefined;
      if (!a) return p;
      return {
        ...p,
        totalScore: p.totalScore - a.scoreAwarded,
        correctCount: p.correctCount - (a.isCorrect ? 1 : 0),
        totalResponseTimeMs: p.totalResponseTimeMs - (a.isCorrect ? a.responseTimeMs : 0),
      };
    });
}

export function rankedParticipants(view: SessionView) {
  return rankParticipants(effectiveParticipants(view));
}

function toEntry(p: ViewParticipant & { rank: number }): LeaderboardEntry {
  return {
    participantId: p.id,
    rank: p.rank,
    nickname: p.nickname,
    totalScore: p.totalScore,
    correctCount: p.correctCount,
  };
}

export interface SnapshotContext {
  ranked: ReturnType<typeof rankedParticipants>;
  rankById: Map<string, number>;
  answerByParticipant: Map<string, ViewAnswer>;
  question: CachedQuestion | null;
  publicQuestion: OpenQuestion | null;
  reveal: RevealData | null;
  leaderboard: LeaderboardEntry[] | null;
  podium: LeaderboardEntry[] | null;
  participantCount: number;
}

/** Pré-computa as partes compartilhadas (ranking, distribuição) para montar N snapshots rapidamente. */
export function prepare(view: SessionView): SnapshotContext {
  const s = view.session;
  const ranked = rankedParticipants(view);
  const q = currentQuestion(view);
  const showQuestion = ['QUESTION_OPEN', 'QUESTION_LOCKED', 'REVEAL'].includes(s.status);
  const publicQuestion =
    q && showQuestion && s.questionOpenedAt && s.questionClosesAt
      ? {
          ...toPublicQuestion(view, q),
          openedAt: s.questionOpenedAt.toISOString(),
          closesAt: s.questionClosesAt.toISOString(),
        }
      : null;
  const showLeaderboard = s.status === 'LEADERBOARD' || s.status === 'FINISHED';
  return {
    ranked,
    rankById: new Map(ranked.map((p) => [p.id, p.rank])),
    answerByParticipant: new Map(view.answers.map((a) => [a.participantId, a])),
    question: q,
    publicQuestion,
    reveal: q && s.status === 'REVEAL' ? buildReveal(view, q) : null,
    leaderboard: showLeaderboard ? ranked.slice(0, LEADERBOARD_SIZE).map(toEntry) : null,
    podium:
      s.status === 'FINISHED'
        ? ranked
            .filter((p) => p.rank <= 3)
            .slice(0, 5)
            .map(toEntry)
        : null,
    participantCount: ranked.length,
  };
}

function base(
  view: SessionView,
  pc: SnapshotContext,
  role: 'host' | 'participant',
): SessionSnapshot {
  const s = view.session;
  return {
    sessionId: s.id,
    role,
    pin: null,
    status: s.status,
    seq: s.stateVersion,
    quizTitle: view.version.title,
    settings: s.settings,
    questionCount: s.questionOrder.length,
    currentIndex: s.currentIndex,
    participantCount: pc.participantCount,
    countdownEndsAt: s.status === 'COUNTDOWN' ? (s.countdownEndsAt?.toISOString() ?? null) : null,
    question: pc.publicQuestion,
    answeredCount: null,
    reveal: pc.reveal,
    leaderboard: pc.leaderboard,
    podium: pc.podium,
    isLastQuestion: s.currentIndex != null && s.currentIndex >= s.questionOrder.length - 1,
    me: null,
    participants: null,
  };
}

export function hostSnapshot(view: SessionView, pc: SnapshotContext): SessionSnapshot {
  const snap = base(view, pc, 'host');
  snap.pin = view.session.pin;
  snap.answeredCount = pc.publicQuestion ? view.answers.length : null;
  snap.participants = pc.ranked.map((p) => ({
    id: p.id,
    nickname: p.nickname,
    status: p.status,
    totalScore: p.totalScore,
  }));
  return snap;
}

export function participantSnapshot(
  view: SessionView,
  pc: SnapshotContext,
  participantId: string,
): SessionSnapshot {
  const snap = base(view, pc, 'participant');
  const p = pc.ranked.find((x) => x.id === participantId);
  if (!p) return snap;
  const s = view.session;
  const answer = pc.answerByParticipant.get(participantId) ?? null;
  // Pontuação da pergunta atual já vem descontada em `pc.ranked` antes da revelação.
  const revealed = s.status === 'REVEAL' || s.status === 'LEADERBOARD' || s.status === 'FINISHED';
  const hideRank = s.settings.hideIntermediateLeaderboard && s.status !== 'FINISHED';
  const me: MeState = {
    participantId: p.id,
    nickname: p.nickname,
    totalScore: p.totalScore,
    correctCount: p.correctCount,
    rank: hideRank ? null : (pc.rankById.get(p.id) ?? null),
    currentAnswer:
      answer && pc.question
        ? { questionId: pc.question.id, selectedOptionIds: answer.selectedOptionIds }
        : null,
    lastResult:
      revealed && pc.question && s.status !== 'FINISHED'
        ? {
            questionId: pc.question.id,
            answered: !!answer,
            isCorrect: answer ? answer.isCorrect : null,
            scoreAwarded: answer?.scoreAwarded ?? 0,
            selectedOptionIds: answer?.selectedOptionIds ?? [],
          }
        : null,
  };
  snap.me = me;
  return snap;
}
