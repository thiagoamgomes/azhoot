import { Hexagon, Orbit, Sparkles, Star, Waves, Zap, type LucideIcon } from 'lucide-react';
import { cn } from '@azhoot/ui';

/**
 * Identidade das alternativas: letra + ícone + cor (nunca apenas cor).
 * Formas e cores próprias do AZhoot.
 */
export const OPTION_STYLES: {
  letter: string;
  icon: LucideIcon;
  tile: string;
  chip: string;
  bar: string;
}[] = [
  {
    letter: 'A',
    icon: Waves,
    tile: 'bg-blue-600 text-white',
    chip: 'bg-blue-600 text-white',
    bar: 'bg-blue-500',
  },
  {
    letter: 'B',
    icon: Zap,
    tile: 'bg-violet-600 text-white',
    chip: 'bg-violet-600 text-white',
    bar: 'bg-violet-500',
  },
  {
    letter: 'C',
    icon: Hexagon,
    tile: 'bg-teal-700 text-white',
    chip: 'bg-teal-700 text-white',
    bar: 'bg-teal-500',
  },
  {
    letter: 'D',
    icon: Star,
    tile: 'bg-amber-400 text-slate-950',
    chip: 'bg-amber-400 text-slate-950',
    bar: 'bg-amber-400',
  },
  {
    letter: 'E',
    icon: Sparkles,
    tile: 'bg-rose-600 text-white',
    chip: 'bg-rose-600 text-white',
    bar: 'bg-rose-500',
  },
  {
    letter: 'F',
    icon: Orbit,
    tile: 'bg-sky-800 text-white',
    chip: 'bg-sky-800 text-white',
    bar: 'bg-sky-500',
  },
];

export function optionStyle(i: number) {
  return OPTION_STYLES[i % OPTION_STYLES.length]!;
}

export function OptionChip({ index, className }: { index: number; className?: string }) {
  const s = optionStyle(index);
  const Icon = s.icon;
  return (
    <span
      className={cn(
        'inline-flex h-9 min-w-9 shrink-0 items-center justify-center gap-1 rounded-lg px-1.5 text-sm font-bold',
        s.chip,
        className,
      )}
      aria-hidden
    >
      <Icon className="size-4" />
      {s.letter}
    </span>
  );
}
