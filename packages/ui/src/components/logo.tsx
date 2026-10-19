import { cn } from '../cn';

/**
 * Marca AZhoot: monograma "A→Z" com pulso (onda) — identidade própria.
 */
export function LogoMark({ className, title = 'AZhoot' }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={cn('size-9', className)} role="img" aria-label={title}>
      <defs>
        <linearGradient id="azh-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3B82F6" />
          <stop offset="1" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill="url(#azh-g)" />
      <path
        d="M11 35 L19.5 13 L28 35"
        fill="none"
        stroke="#fff"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14.5 27 H24.5" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
      <path
        d="M27 17 H37 L27 33 H37"
        fill="none"
        stroke="#BFDBFE"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="39" cy="11" r="3" fill="#A78BFA" />
    </svg>
  );
}

export function Logo({ className, inverted }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span
        className={cn(
          'font-display text-xl font-bold tracking-tight',
          inverted ? 'text-white' : 'text-foreground',
        )}
      >
        AZ<span className="text-primary">hoot</span>
      </span>
    </span>
  );
}
