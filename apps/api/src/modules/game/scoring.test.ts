import { describe, expect, it } from 'vitest';
import { computeScore, evaluateAnswer, rankParticipants } from './scoring';

describe('computeScore', () => {
  const base = { basePoints: 1000, isCorrect: true, openedAt: 0, closesAt: 20_000 };
  it('resposta instantânea recebe o total', () => {
    expect(computeScore({ ...base, receivedAt: 0 })).toBe(1000);
  });
  it('resposta no limite recebe metade', () => {
    expect(computeScore({ ...base, receivedAt: 20_000 })).toBe(500);
  });
  it('proporcional ao tempo restante', () => {
    expect(computeScore({ ...base, receivedAt: 5_000 })).toBe(875);
    expect(computeScore({ ...base, basePoints: 2000, receivedAt: 10_000 })).toBe(1500);
  });
  it('limita a razão entre 0 e 1', () => {
    expect(computeScore({ ...base, receivedAt: -5000 })).toBe(1000);
    expect(computeScore({ ...base, receivedAt: 30_000 })).toBe(500);
  });
  it('errada, enquete ou 0 pontos = 0', () => {
    expect(computeScore({ ...base, isCorrect: false, receivedAt: 0 })).toBe(0);
    expect(computeScore({ ...base, basePoints: 0, receivedAt: 0 })).toBe(0);
  });
});

describe('evaluateAnswer', () => {
  it('única escolha', () => {
    expect(evaluateAnswer('SINGLE_CHOICE', ['a'], ['a'])).toBe(true);
    expect(evaluateAnswer('SINGLE_CHOICE', ['a'], ['b'])).toBe(false);
    expect(evaluateAnswer('SINGLE_CHOICE', ['a'], ['a', 'b'])).toBe(false);
  });
  it('múltipla escolha exige o conjunto exato', () => {
    expect(evaluateAnswer('MULTIPLE_CHOICE', ['a', 'b'], ['b', 'a'])).toBe(true);
    expect(evaluateAnswer('MULTIPLE_CHOICE', ['a', 'b'], ['a'])).toBe(false);
    expect(evaluateAnswer('MULTIPLE_CHOICE', ['a', 'b'], ['a', 'b', 'c'])).toBe(false);
    expect(evaluateAnswer('MULTIPLE_CHOICE', ['a', 'b'], ['a', 'a'])).toBe(false);
  });
  it('enquete não tem correção', () => {
    expect(evaluateAnswer('POLL', [], ['a'])).toBeNull();
  });
});

describe('rankParticipants', () => {
  it('aplica critérios de desempate e empate compartilhado', () => {
    const ranked = rankParticipants([
      { id: 'a', totalScore: 1000, correctCount: 1, totalResponseTimeMs: 5000 },
      { id: 'b', totalScore: 1000, correctCount: 2, totalResponseTimeMs: 9000 },
      { id: 'c', totalScore: 1000, correctCount: 1, totalResponseTimeMs: 3000 },
      { id: 'd', totalScore: 1000, correctCount: 1, totalResponseTimeMs: 3000 },
      { id: 'e', totalScore: 2000, correctCount: 2, totalResponseTimeMs: 1 },
    ]);
    expect(ranked.map((r) => [r.id, r.rank])).toEqual([
      ['e', 1],
      ['b', 2],
      ['c', 3],
      ['d', 3],
      ['a', 5],
    ]);
  });
});
