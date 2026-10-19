import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { PublicQuestion, RevealData } from '@azhoot/contracts';
import { AnswerPad } from './AnswerPad';
import { QuestionStage } from './QuestionStage';

const q = (over: Partial<PublicQuestion> = {}): PublicQuestion => ({
  id: 'q1',
  index: 0,
  total: 3,
  type: 'SINGLE_CHOICE',
  prompt: 'Qual a capital?',
  imageUrl: null,
  durationSeconds: 20,
  basePoints: 1000,
  options: [
    { id: 'a', text: 'Brasília', imageUrl: null },
    { id: 'b', text: 'Recife', imageUrl: null },
  ],
  ...over,
});

describe('AnswerPad', () => {
  it('única escolha envia ao tocar', async () => {
    const onSubmit = vi.fn();
    render(<AnswerPad question={q()} onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole('radio', { name: /Brasília/ }));
    expect(onSubmit).toHaveBeenCalledWith(['a']);
  });

  it('múltipla escolha exige confirmar', async () => {
    const onSubmit = vi.fn();
    render(<AnswerPad question={q({ type: 'MULTIPLE_CHOICE' })} onSubmit={onSubmit} />);
    const send = screen.getByRole('button', { name: /Enviar resposta/ });
    expect(send).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /Brasília/ }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Recife/ }));
    await userEvent.click(send);
    expect(onSubmit).toHaveBeenCalledWith(['a', 'b']);
  });

  it('após responder, trava as alternativas', () => {
    render(<AnswerPad question={q()} selected={['a']} onSubmit={() => undefined} />);
    for (const r of screen.getAllByRole('radio')) expect(r).toBeDisabled();
    expect(screen.getByRole('radio', { name: /Brasília/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('alternativas identificadas por letra além da cor', () => {
    render(<AnswerPad question={q()} onSubmit={() => undefined} />);
    expect(screen.getByRole('radio', { name: /A\s*Brasília/ })).toBeInTheDocument();
  });
});

describe('QuestionStage', () => {
  it('não indica a correta antes da revelação', () => {
    render(<QuestionStage question={q()} />);
    expect(screen.queryByLabelText('Correta')).not.toBeInTheDocument();
  });

  it('marca a correta e a distribuição na revelação', () => {
    const reveal: RevealData = {
      questionId: 'q1',
      correctOptionIds: ['a'],
      distribution: [
        { optionId: 'a', count: 3 },
        { optionId: 'b', count: 1 },
      ],
      totalAnswers: 4,
      correctAnswers: 3,
      explanation: null,
    };
    render(<QuestionStage question={q()} reveal={reveal} />);
    expect(screen.getAllByLabelText('Correta')).toHaveLength(1);
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
