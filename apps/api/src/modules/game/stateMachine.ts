import type { GameStatus } from '@azhoot/contracts';
import { AppError } from '../../lib/errors';

export type GameAction =
  'start' | 'countdownDone' | 'lock' | 'reveal' | 'leaderboard' | 'next' | 'finish' | 'cancel';

/**
 * Transições válidas (docs/specs/realtime.md). `next` a partir de REVEAL/LEADERBOARD
 * leva a QUESTION_OPEN ou, na última pergunta, a FINISHED — decidido por `resolveNext`.
 */
const TRANSITIONS: Record<GameStatus, Partial<Record<GameAction, GameStatus>>> = {
  LOBBY: { start: 'COUNTDOWN', cancel: 'CANCELLED', finish: 'CANCELLED' },
  COUNTDOWN: { countdownDone: 'QUESTION_OPEN', finish: 'FINISHED' },
  QUESTION_OPEN: { lock: 'QUESTION_LOCKED', finish: 'FINISHED' },
  QUESTION_LOCKED: { reveal: 'REVEAL', finish: 'FINISHED' },
  REVEAL: { leaderboard: 'LEADERBOARD', next: 'QUESTION_OPEN', finish: 'FINISHED' },
  LEADERBOARD: { next: 'QUESTION_OPEN', finish: 'FINISHED' },
  FINISHED: {},
  CANCELLED: {},
};

export function canTransition(from: GameStatus, action: GameAction): boolean {
  return TRANSITIONS[from][action] !== undefined;
}

/** Retorna o próximo estado ou lança INVALID_TRANSITION sem alterar nada. */
export function nextStatus(
  from: GameStatus,
  action: GameAction,
  opts: { isLastQuestion?: boolean } = {},
): GameStatus {
  const to = TRANSITIONS[from][action];
  if (!to) throw new AppError('INVALID_TRANSITION', { from, action });
  if (action === 'next' && opts.isLastQuestion) return 'FINISHED';
  return to;
}

export function isTerminal(status: GameStatus) {
  return status === 'FINISHED' || status === 'CANCELLED';
}
