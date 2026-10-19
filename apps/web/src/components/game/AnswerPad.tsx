import { Check, Send } from 'lucide-react';
import { useState } from 'react';
import type { PublicQuestion } from '@azhoot/contracts';
import { Button, cn } from '@azhoot/ui';
import { optionStyle } from './options';

interface Props {
  question: PublicQuestion;
  disabled?: boolean;
  selected?: string[] | null;
  submitting?: boolean;
  onSubmit: (optionIds: string[]) => void;
  showPrompt?: boolean;
}

/** Botões grandes para uso com uma mão. Múltipla escolha exige confirmar. */
export function AnswerPad({
  question,
  disabled,
  selected,
  submitting,
  onSubmit,
  showPrompt = true,
}: Props) {
  const multi = question.type === 'MULTIPLE_CHOICE';
  const [picked, setPicked] = useState<string[]>([]);
  const locked = disabled || !!selected;
  const chosen = new Set(selected ?? picked);

  return (
    <div className="flex flex-1 flex-col gap-3">
      {showPrompt && (
        <p className="line-clamp-3 text-center font-display text-lg font-semibold leading-snug">
          {question.prompt}
        </p>
      )}
      {multi && !locked && (
        <p className="text-center text-sm text-slate-300">
          Selecione todas as corretas e toque em Enviar.
        </p>
      )}
      <div
        className={cn(
          'grid flex-1 content-end gap-3',
          question.options.length > 2 && question.options.length !== 3
            ? 'grid-cols-2'
            : 'grid-cols-1',
        )}
        role={multi ? 'group' : 'radiogroup'}
        aria-label="Alternativas"
      >
        {question.options.map((o, i) => {
          const s = optionStyle(i);
          const Icon = s.icon;
          const isChosen = chosen.has(o.id);
          return (
            <button
              key={o.id}
              type="button"
              role={multi ? 'checkbox' : 'radio'}
              aria-checked={isChosen}
              disabled={locked || submitting}
              onClick={() => {
                if (multi)
                  setPicked((p) => (p.includes(o.id) ? p.filter((x) => x !== o.id) : [...p, o.id]));
                else onSubmit([o.id]);
              }}
              className={cn(
                'relative flex min-h-28 flex-col items-center justify-center gap-1 rounded-2xl p-3 text-center text-base font-semibold shadow-lg outline-offset-4 transition-transform duration-150 active:scale-[0.98] disabled:cursor-default',
                s.tile,
                locked && !isChosen && 'opacity-30',
                isChosen && 'ring-4 ring-white',
              )}
            >
              <span className="flex items-center gap-1 text-sm font-bold opacity-90">
                <Icon className="size-5" aria-hidden /> {s.letter}
              </span>
              <span className="line-clamp-3 break-words">{o.text}</span>
              {isChosen && (
                <span className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-white text-slate-900">
                  <Check className="size-4" strokeWidth={3} aria-hidden />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {multi && !locked && (
        <Button
          size="xl"
          className="w-full"
          disabled={picked.length === 0}
          loading={submitting}
          onClick={() => onSubmit(picked)}
        >
          <Send /> Enviar resposta
        </Button>
      )}
    </div>
  );
}
