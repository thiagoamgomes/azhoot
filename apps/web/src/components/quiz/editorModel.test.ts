import { describe, expect, it } from 'vitest';
import { changeType, mergeServerIds, newQuestion, toPayload } from './editorModel';

describe('editorModel', () => {
  it('troca para verdadeiro/falso recria alternativas', () => {
    const q = changeType(newQuestion('SINGLE_CHOICE'), 'TRUE_FALSE');
    expect(q.options.map((o) => o.text)).toEqual(['Verdadeiro', 'Falso']);
    expect(q.options.filter((o) => o.isCorrect)).toHaveLength(1);
  });

  it('enquete zera pontos e corretas', () => {
    const q = changeType(newQuestion('SINGLE_CHOICE'), 'POLL');
    expect(q.basePoints).toBe(0);
    expect(q.options.some((o) => o.isCorrect)).toBe(false);
  });

  it('única escolha mantém apenas uma correta', () => {
    const multi = newQuestion('MULTIPLE_CHOICE');
    multi.options = multi.options.map((o) => ({ ...o, isCorrect: true }));
    const single = changeType(multi, 'SINGLE_CHOICE');
    expect(single.options.filter((o) => o.isCorrect)).toHaveLength(1);
  });

  it('aplica IDs do servidor por posição', () => {
    const d = {
      title: 't',
      description: '',
      category: '',
      coverImageUrl: null,
      questions: [newQuestion()],
    };
    const merged = mergeServerIds(d, [
      {
        id: '11111111-1111-4111-8111-111111111111',
        type: 'SINGLE_CHOICE',
        prompt: '',
        imageUrl: null,
        durationSeconds: 20,
        basePoints: 1000,
        explanation: null,
        options: d.questions[0]!.options.map((_, i) => ({
          id: `2222222${i}-2222-4222-8222-222222222222`,
          text: '',
          imageUrl: null,
          isCorrect: false,
        })),
      },
    ]);
    expect(merged.questions[0]!.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(toPayload(merged).questions[0]!.options[0]!.id).toBe(
      '22222220-2222-4222-8222-222222222222',
    );
    expect(merged.questions[0]!.key).toBe(d.questions[0]!.key);
  });
});
