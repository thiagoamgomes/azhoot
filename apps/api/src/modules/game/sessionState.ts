import { sessionSettingsSchema, type GameStatus, type SessionSettings } from '@azhoot/contracts';
import type { GameSession } from '@azhoot/db';

export interface ParsedSession {
  id: string;
  quizVersionId: string;
  hostUserId: string;
  pin: string | null;
  status: GameStatus;
  stateVersion: number;
  currentIndex: number | null;
  questionOrder: string[];
  optionOrder: Record<string, string[]>;
  settings: SessionSettings;
  countdownEndsAt: Date | null;
  questionOpenedAt: Date | null;
  questionClosesAt: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
}

export function parseSession(s: GameSession): ParsedSession {
  return {
    id: s.id,
    quizVersionId: s.quizVersionId,
    hostUserId: s.hostUserId,
    pin: s.pin,
    status: s.status as GameStatus,
    stateVersion: s.stateVersion,
    currentIndex: s.currentQuestionPosition,
    questionOrder: Array.isArray(s.questionOrder) ? (s.questionOrder as string[]) : [],
    optionOrder: (s.optionOrder ?? {}) as Record<string, string[]>,
    settings: sessionSettingsSchema.parse(s.settings ?? {}),
    countdownEndsAt: s.countdownEndsAt,
    questionOpenedAt: s.questionOpenedAt,
    questionClosesAt: s.questionClosesAt,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    createdAt: s.createdAt,
  };
}

export function currentQuestionId(s: ParsedSession): string | null {
  if (s.currentIndex == null) return null;
  return s.questionOrder[s.currentIndex] ?? null;
}
