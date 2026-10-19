import { cn } from '@azhoot/ui';

/** Contador circular. Não é anunciado a cada segundo (aria-hidden); anúncios são feitos pela tela. */
export function Timer({
  seconds,
  total,
  className,
  size = 96,
}: {
  seconds: number;
  total: number;
  className?: string;
  size?: number;
}) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const ratio = total > 0 ? Math.min(1, seconds / total) : 0;
  const urgent = seconds <= 5 && seconds > 0;
  return (
    <div
      className={cn('relative grid place-items-center', className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.15"
          strokeWidth="8"
        />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke={urgent ? '#F59E0B' : '#60A5FA'}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - ratio)}
          style={{ transition: 'stroke-dashoffset 200ms linear' }}
        />
      </svg>
      <span
        className={cn('font-display font-bold tabular-nums', urgent && 'text-amber-300')}
        style={{ fontSize: size * 0.34 }}
        aria-hidden
      >
        {seconds}
      </span>
      <span className="sr-only">Tempo restante</span>
    </div>
  );
}
