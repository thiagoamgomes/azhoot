import { Check } from 'lucide-react';
import type { PublicQuestion, RevealData } from '@azhoot/contracts';
import { cn } from '@azhoot/ui';
import { optionStyle } from './options';

/** Gráfico de distribuição das respostas. Acessível: cada barra tem texto com contagem. */
export function RevealChart({
  question,
  reveal,
  className,
}: {
  question: PublicQuestion;
  reveal: RevealData;
  className?: string;
}) {
  const max = Math.max(1, ...reveal.distribution.map((d) => d.count));
  const correct = new Set(reveal.correctOptionIds);
  return (
    <figure className={cn('grid gap-3', className)}>
      <div
        className="flex h-[26vmin] items-end justify-center gap-[3vmin]"
        role="list"
        aria-label="Distribuição das respostas"
      >
        {question.options.map((o, i) => {
          const d = reveal.distribution.find((x) => x.optionId === o.id);
          const count = d?.count ?? 0;
          const s = optionStyle(i);
          const Icon = s.icon;
          return (
            <div
              key={o.id}
              role="listitem"
              className="flex h-full w-[10vmin] flex-col items-center justify-end gap-2"
            >
              <span className="font-display text-[3vmin] font-bold tabular-nums">{count}</span>
              <div
                className={cn(
                  'w-full rounded-t-xl',
                  s.bar,
                  question.type !== 'POLL' && !correct.has(o.id) && 'opacity-40',
                )}
                style={{
                  height: `${Math.max(4, (count / max) * 100)}%`,
                  transition: 'height 250ms ease-out',
                }}
                aria-label={`${s.letter}: ${o.text} — ${count} resposta(s)${correct.has(o.id) ? ', correta' : ''}`}
              />
              <span
                className={cn(
                  'flex items-center gap-1 rounded-lg px-2 py-1 text-[2vmin] font-bold',
                  s.chip,
                )}
              >
                <Icon className="size-[2vmin]" aria-hidden />
                {s.letter}
                {correct.has(o.id) && question.type !== 'POLL' && (
                  <Check className="size-[2vmin]" strokeWidth={3} aria-hidden />
                )}
              </span>
            </div>
          );
        })}
      </div>
      <figcaption className="text-center text-[2vmin] text-slate-300">
        {reveal.totalAnswers} resposta(s)
        {question.type !== 'POLL' && ` · ${reveal.correctAnswers} correta(s)`}
      </figcaption>
    </figure>
  );
}
