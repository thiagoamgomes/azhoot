import { Check, Users } from 'lucide-react';
import type { PublicQuestion, RevealData } from '@azhoot/contracts';
import { QUESTION_TYPE_LABELS } from '@azhoot/contracts';
import { cn } from '@azhoot/ui';
import { assetUrl } from '@/lib/config';
import { optionStyle } from './options';

interface Props {
  question: PublicQuestion;
  reveal?: RevealData | null;
  timer?: React.ReactNode;
  answeredCount?: number | null;
  participantCount?: number;
  compact?: boolean;
}

/** Tela coletiva (16:9) de uma pergunta. Legível à distância. */
export function QuestionStage({
  question,
  reveal,
  timer,
  answeredCount,
  participantCount,
  compact,
}: Props) {
  const correct = new Set(reveal?.correctOptionIds ?? []);
  const counts = new Map(reveal?.distribution.map((d) => [d.optionId, d.count]) ?? []);
  const max = Math.max(1, ...(reveal?.distribution.map((d) => d.count) ?? [1]));
  const poll = question.type === 'POLL';
  return (
    <div className={cn('flex h-full flex-col gap-[2.5vmin] text-white', compact && 'gap-3')}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <span
            className={cn(
              'font-semibold uppercase tracking-wider text-blue-300',
              compact ? 'text-[10px]' : 'text-[1.6vmin]',
            )}
          >
            Pergunta {question.index + 1} de {question.total} ·{' '}
            {QUESTION_TYPE_LABELS[question.type]}
            {question.type === 'MULTIPLE_CHOICE' && ' · várias corretas'}
          </span>
        </div>
        <div className="flex items-center gap-4">
          {answeredCount != null && (
            <div
              className={cn(
                'flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-2 font-semibold',
                compact ? 'text-xs' : 'text-[2.2vmin]',
              )}
              aria-live="polite"
            >
              <Users className={compact ? 'size-3' : 'size-[2.4vmin]'} aria-hidden />
              <span>
                {answeredCount}
                {participantCount != null && `/${participantCount}`} respostas
              </span>
            </div>
          )}
          {timer}
        </div>
      </div>

      <div
        className={cn(
          'flex min-h-0 flex-1 gap-[3vmin]',
          !question.imageUrl && 'flex-col justify-center',
        )}
      >
        <h2
          className={cn(
            'font-display font-bold leading-tight text-balance',
            compact ? 'text-lg' : 'text-[5vmin]',
            question.imageUrl && 'flex-1',
          )}
        >
          {question.prompt}
        </h2>
        {question.imageUrl && (
          <div className="flex max-h-full min-h-0 flex-1 items-center justify-center overflow-hidden rounded-2xl bg-black/20">
            <img
              src={assetUrl(question.imageUrl)}
              alt=""
              className="max-h-full max-w-full object-contain"
            />
          </div>
        )}
      </div>

      <ul
        className={cn(
          'grid gap-[1.6vmin]',
          question.options.length <= 2
            ? 'grid-cols-2'
            : question.options.length <= 4
              ? 'grid-cols-2'
              : 'grid-cols-3',
          compact && 'gap-2',
        )}
      >
        {question.options.map((o, i) => {
          const s = optionStyle(i);
          const Icon = s.icon;
          const isCorrect = correct.has(o.id);
          const dim = reveal && !poll && !isCorrect;
          const count = counts.get(o.id) ?? 0;
          return (
            <li
              key={o.id}
              className={cn(
                'relative flex items-center gap-[1.6vmin] overflow-hidden rounded-2xl px-[2vmin] py-[1.8vmin] font-semibold shadow-lg transition-opacity duration-200',
                s.tile,
                dim && 'opacity-50',
                compact ? 'min-h-10 px-3 py-2 text-xs' : 'min-h-[9vmin] text-[2.8vmin]',
              )}
            >
              <span
                className={cn(
                  'flex shrink-0 items-center gap-1 rounded-lg bg-black/15 font-bold',
                  compact ? 'px-1.5 py-0.5' : 'px-[1vmin] py-[0.5vmin]',
                )}
              >
                <Icon className={compact ? 'size-3' : 'size-[2.8vmin]'} aria-hidden />
                {s.letter}
              </span>
              <span className="min-w-0 flex-1 break-words">{o.text}</span>
              {reveal && (
                <span className="flex shrink-0 items-center gap-2">
                  {isCorrect && !poll && (
                    <span
                      className="grid place-items-center rounded-full bg-white p-1 text-success"
                      aria-label="Correta"
                    >
                      <Check className={compact ? 'size-3' : 'size-[2.6vmin]'} strokeWidth={3} />
                    </span>
                  )}
                  <span className="tabular-nums">{count}</span>
                </span>
              )}
              {reveal && (
                <span
                  className="absolute inset-y-0 left-0 -z-0 bg-white/15"
                  style={{ width: `${(count / max) * 100}%`, transition: 'width 250ms ease-out' }}
                  aria-hidden
                />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
