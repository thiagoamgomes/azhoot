import { describe, expect, it } from 'vitest';
import { validateQuizForPublish, type QuestionDraft } from './quiz';

const q = (over: Partial<QuestionDraft> = {}): QuestionDraft => ({
  type: 'SINGLE_CHOICE',
  prompt: 'Qual a capital do Brasil?',
  imageUrl: null,
  durationSeconds: 20,
  basePoints: 1000,
  explanation: null,
  options: [
    { text: 'Brasília', imageUrl: null, isCorrect: true },
    { text: 'Rio de Janeiro', imageUrl: null, isCorrect: false },
  ],
  ...over,
});

describe('validateQuizForPublish', () => {
  it('aceita quiz válido', () => {
    expect(validateQuizForPublish({ title: 'Geografia', questions: [q()] })).toEqual([]);
  });

  it('exige título e perguntas', () => {
    const issues = validateQuizForPublish({ title: 'a', questions: [] });
    expect(issues.map((i) => i.path)).toEqual(['title', 'questions']);
  });

  it('valida enunciado, alternativas vazias e repetidas', () => {
    const issues = validateQuizForPublish({
      title: 'Teste',
      questions: [
        q({
          prompt: 'ab',
          options: [
            { text: 'A', imageUrl: null, isCorrect: true },
            { text: 'a', imageUrl: null, isCorrect: false },
            { text: ' ', imageUrl: null, isCorrect: false },
          ],
        }),
      ],
    });
    const msgs = issues.map((i) => i.message).join('\n');
    expect(msgs).toContain('enunciado');
    expect(msgs).toContain('alternativa 3 está vazia');
    expect(msgs).toContain('repetidas');
    expect(issues.every((i) => i.questionIndex === 0)).toBe(true);
  });

  it('única escolha exige exatamente uma correta', () => {
    const issues = validateQuizForPublish({
      title: 'Teste',
      questions: [q({ options: q().options.map((o) => ({ ...o, isCorrect: true })) })],
    });
    expect(issues[0]?.message).toContain('exatamente 1');
  });

  it('múltipla escolha exige ao menos duas corretas', () => {
    const issues = validateQuizForPublish({
      title: 'Teste',
      questions: [q({ type: 'MULTIPLE_CHOICE' })],
    });
    expect(issues[0]?.message).toContain('pelo menos 2');
  });

  it('enquete ignora corretas e pontos', () => {
    const issues = validateQuizForPublish({
      title: 'Teste',
      questions: [q({ type: 'POLL', basePoints: 1000 })],
    });
    expect(issues).toEqual([]);
  });

  it('verdadeiro/falso exige 2 alternativas e 1 correta', () => {
    const issues = validateQuizForPublish({
      title: 'Teste',
      questions: [
        q({
          type: 'TRUE_FALSE',
          options: [
            { text: 'Verdadeiro', imageUrl: null, isCorrect: false },
            { text: 'Falso', imageUrl: null, isCorrect: false },
            { text: 'Talvez', imageUrl: null, isCorrect: false },
          ],
        }),
      ],
    });
    expect(issues.length).toBe(2);
  });

  it('limites de 2 a 6 alternativas', () => {
    const one = validateQuizForPublish({
      title: 'Teste',
      questions: [q({ options: [{ text: 'Só', imageUrl: null, isCorrect: true }] })],
    });
    expect(one.some((i) => i.message.includes('2 a 6'))).toBe(true);
  });
});
