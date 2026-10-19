import { describe, expect, it } from 'vitest';
import { GAME_STATUSES } from '@azhoot/contracts';
import { canTransition, nextStatus, type GameAction } from './stateMachine';

describe('máquina de estados', () => {
  it('segue o fluxo principal', () => {
    expect(nextStatus('LOBBY', 'start')).toBe('COUNTDOWN');
    expect(nextStatus('COUNTDOWN', 'countdownDone')).toBe('QUESTION_OPEN');
    expect(nextStatus('QUESTION_OPEN', 'lock')).toBe('QUESTION_LOCKED');
    expect(nextStatus('QUESTION_LOCKED', 'reveal')).toBe('REVEAL');
    expect(nextStatus('REVEAL', 'leaderboard')).toBe('LEADERBOARD');
    expect(nextStatus('LEADERBOARD', 'next')).toBe('QUESTION_OPEN');
    expect(nextStatus('REVEAL', 'next')).toBe('QUESTION_OPEN');
  });

  it('última pergunta encerra no next', () => {
    expect(nextStatus('REVEAL', 'next', { isLastQuestion: true })).toBe('FINISHED');
    expect(nextStatus('LEADERBOARD', 'next', { isLastQuestion: true })).toBe('FINISHED');
  });

  it('cancelar no lobby e encerrar durante a partida', () => {
    expect(nextStatus('LOBBY', 'cancel')).toBe('CANCELLED');
    expect(nextStatus('QUESTION_OPEN', 'finish')).toBe('FINISHED');
  });

  it('transições inválidas lançam erro', () => {
    expect(() => nextStatus('LOBBY', 'reveal')).toThrow();
    expect(() => nextStatus('QUESTION_OPEN', 'next')).toThrow();
    expect(() => nextStatus('FINISHED', 'start')).toThrow();
  });

  it('estados terminais não aceitam nenhuma ação', () => {
    const actions: GameAction[] = [
      'start',
      'countdownDone',
      'lock',
      'reveal',
      'leaderboard',
      'next',
      'finish',
      'cancel',
    ];
    for (const s of ['FINISHED', 'CANCELLED'] as const) {
      for (const a of actions) expect(canTransition(s, a)).toBe(false);
    }
    expect(GAME_STATUSES.length).toBe(8);
  });
});
