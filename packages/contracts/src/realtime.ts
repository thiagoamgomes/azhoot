import { z } from 'zod';
import { CONTRACT_VERSION, type GameStatus, type QuestionType } from './constants';
import type { ErrorCode } from './errors';
import type { SessionSettings } from './session';

/* ------------------------------------------------------------------ */
/* Nomes de eventos                                                    */
/* ------------------------------------------------------------------ */

export const CLIENT_EVENTS = {
  participantJoin: 'participant:join',
  participantResume: 'participant:resume',
  participantAnswer: 'participant:answer',
  hostJoin: 'host:join',
  hostStart: 'host:start',
  hostLockQuestion: 'host:lock-question',
  hostReveal: 'host:reveal',
  hostShowLeaderboard: 'host:show-leaderboard',
  hostNextQuestion: 'host:next-question',
  hostEnd: 'host:end',
  hostRemoveParticipant: 'host:remove-participant',
  clockSync: 'clock:sync',
} as const;
export type ClientEventName = (typeof CLIENT_EVENTS)[keyof typeof CLIENT_EVENTS];

export const SERVER_EVENTS = {
  snapshot: 'session:snapshot',
  participantJoined: 'lobby:participant-joined',
  participantLeft: 'lobby:participant-left',
  countdown: 'game:countdown',
  questionOpened: 'game:question-opened',
  questionLocked: 'game:question-locked',
  answerAccepted: 'game:answer-accepted',
  answersProgress: 'game:answers-progress',
  reveal: 'game:reveal',
  leaderboard: 'game:leaderboard',
  finished: 'game:finished',
  error: 'session:error',
} as const;
export type ServerEventName = (typeof SERVER_EVENTS)[keyof typeof SERVER_EVENTS];

/* ------------------------------------------------------------------ */
/* Envelopes                                                           */
/* ------------------------------------------------------------------ */

/** Envelope enviado pelo cliente. `serverTime` não se aplica. */
export const clientEnvelopeSchema = <T extends z.ZodType>(payload: T) =>
  z.object({
    v: z.literal(CONTRACT_VERSION),
    eventId: z.uuid(),
    sessionId: z.uuid(),
    payload,
  });

export interface ServerEnvelope<P> {
  v: typeof CONTRACT_VERSION;
  eventId: string;
  sessionId: string;
  serverTime: string;
  /** Sequência de estado (stateVersion) no momento do envio. */
  seq: number;
  payload: P;
}

export const serverEnvelopeSchema = z.object({
  v: z.literal(CONTRACT_VERSION),
  eventId: z.string(),
  sessionId: z.string(),
  serverTime: z.string(),
  seq: z.number().int(),
  payload: z.unknown(),
});

export type Ack<T = unknown> =
  { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string } };

/* ------------------------------------------------------------------ */
/* Payloads cliente → servidor                                         */
/* ------------------------------------------------------------------ */

export const participantJoinPayload = z.object({ token: z.string().min(20).max(200) });
export const participantResumePayload = z.object({
  token: z.string().min(20).max(200),
  lastSeq: z.number().int().min(0).optional(),
});
export const participantAnswerPayload = z.object({
  /** Opcional: a identidade vem do socket autenticado em participant:join/resume. */
  token: z.string().min(20).max(200).optional(),
  answerId: z.uuid(),
  questionId: z.uuid(),
  optionIds: z.array(z.uuid()).min(1).max(6),
});
export type ParticipantAnswerPayload = z.infer<typeof participantAnswerPayload>;

/** Comandos do host carregam a sequência esperada para evitar avanço duplicado. */
export const hostCommandPayload = z.object({ expectedSeq: z.number().int().min(0).optional() });
export const hostRemovePayload = hostCommandPayload.extend({
  participantId: z.uuid(),
  block: z.boolean().default(false),
});

export const CLIENT_PAYLOAD_SCHEMAS = {
  'participant:join': participantJoinPayload,
  'participant:resume': participantResumePayload,
  'participant:answer': participantAnswerPayload,
  'host:join': z.object({}).passthrough(),
  'host:start': hostCommandPayload,
  'host:lock-question': hostCommandPayload,
  'host:reveal': hostCommandPayload,
  'host:show-leaderboard': hostCommandPayload,
  'host:next-question': hostCommandPayload,
  'host:end': hostCommandPayload,
  'host:remove-participant': hostRemovePayload,
} as const;

/* ------------------------------------------------------------------ */
/* Payloads servidor → cliente                                         */
/* ------------------------------------------------------------------ */

export interface PublicOption {
  id: string;
  text: string;
  imageUrl: string | null;
}

/** Pergunta como vista durante QUESTION_OPEN: nunca contém isCorrect nem explicação. */
export interface PublicQuestion {
  id: string;
  index: number;
  total: number;
  type: QuestionType;
  prompt: string;
  imageUrl: string | null;
  durationSeconds: number;
  basePoints: number;
  options: PublicOption[];
}

export interface OpenQuestion extends PublicQuestion {
  openedAt: string;
  closesAt: string;
}

export interface RevealData {
  questionId: string;
  correctOptionIds: string[];
  distribution: { optionId: string; count: number }[];
  totalAnswers: number;
  correctAnswers: number;
  explanation: string | null;
}

export interface LeaderboardEntry {
  participantId: string;
  rank: number;
  nickname: string;
  totalScore: number;
  correctCount: number;
}

export interface MyResult {
  questionId: string;
  answered: boolean;
  isCorrect: boolean | null;
  scoreAwarded: number;
  selectedOptionIds: string[];
}

export interface MeState {
  participantId: string;
  nickname: string;
  totalScore: number;
  rank: number | null;
  correctCount: number;
  /** Resposta registrada para a pergunta atual (sem correção antes da revelação). */
  currentAnswer: { questionId: string; selectedOptionIds: string[] } | null;
  /** Resultado da última pergunta revelada. */
  lastResult: MyResult | null;
}

export interface HostParticipant {
  id: string;
  nickname: string;
  status: 'ACTIVE' | 'DISCONNECTED' | 'REMOVED' | 'BLOCKED';
  totalScore: number;
}

export interface SessionSnapshot {
  sessionId: string;
  role: 'host' | 'participant';
  pin: string | null;
  status: GameStatus;
  seq: number;
  quizTitle: string;
  settings: SessionSettings;
  questionCount: number;
  currentIndex: number | null;
  participantCount: number;
  countdownEndsAt: string | null;
  question: OpenQuestion | null;
  answeredCount: number | null;
  reveal: RevealData | null;
  leaderboard: LeaderboardEntry[] | null;
  podium: LeaderboardEntry[] | null;
  isLastQuestion: boolean;
  /** Somente participante. */
  me: MeState | null;
  /** Somente host. */
  participants: HostParticipant[] | null;
}

export interface ParticipantPresencePayload {
  participant: { id: string; nickname: string; status: HostParticipant['status'] };
  participantCount: number;
  reason?: 'disconnected' | 'removed' | 'blocked';
}

export interface AnswerAcceptedPayload {
  questionId: string;
  answerId: string;
  selectedOptionIds: string[];
  duplicate: boolean;
}

export interface AnswersProgressPayload {
  questionId: string;
  answeredCount: number;
  participantCount: number;
}

export type AnyServerPayload =
  SessionSnapshot | ParticipantPresencePayload | AnswerAcceptedPayload | AnswersProgressPayload;

export interface ClockSyncResponse {
  serverTime: string;
}
