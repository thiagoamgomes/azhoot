import { useId, useMemo, useState } from 'react';
import { cn } from '@azhoot/ui';

/**
 * Gráficos leves em SVG (sem dependências), com tooltip ao passar o mouse/foco,
 * legenda para 2+ séries e alternância para tabela (acessibilidade).
 * Paleta categórica validada (claro/escuro) — ver .claude/skills/dataviz.
 */
export interface Series {
  key: string;
  label: string;
  values: number[];
}

const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)'];

interface Props {
  title: string;
  labels: string[];
  series: Series[];
  type?: 'bar' | 'line';
  format?: (v: number) => string;
  height?: number;
  className?: string;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const n = v / exp;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * exp;
}

export function Chart({
  title,
  labels,
  series,
  type = 'bar',
  format = (v) => v.toLocaleString('pt-BR'),
  height = 220,
  className,
}: Props) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 640;
  const H = height;
  const pad = { l: 56, r: 12, t: 12, b: 28 };
  const max = useMemo(() => niceMax(Math.max(0, ...series.flatMap((s) => s.values))), [series]);
  const n = labels.length;
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const step = n ? iw / n : iw;
  const y = (v: number) => pad.t + ih - (v / max) * ih;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const groupW = Math.min(step * 0.7, 48);
  const barW = Math.max(3, (groupW - (series.length - 1) * 2) / series.length);
  const labelEvery = Math.ceil(n / 12);
  const empty = series.every((s) => s.values.every((v) => !v));

  return (
    <figure className={cn('grid gap-2', className)} aria-labelledby={`${id}-t`}>
      <div className="flex items-center justify-between gap-2">
        <figcaption id={`${id}-t`} className="text-sm font-semibold">
          {title}
        </figcaption>
        <button
          type="button"
          className="text-xs text-primary underline-offset-2 hover:underline"
          onClick={() => setTable((t) => !t)}
        >
          {table ? 'Ver gráfico' : 'Ver tabela'}
        </button>
      </div>
      {series.length > 1 && (
        <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="Legenda">
          {series.map((s, i) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-sm"
                style={{ background: COLORS[i] }}
                aria-hidden
              />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      {table ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 pr-3">
                  Mês
                </th>
                {series.map((s) => (
                  <th key={s.key} scope="col" className="py-1 pr-3 text-right">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {labels.map((l, i) => (
                <tr key={l}>
                  <td className="py-1 pr-3">{l}</td>
                  {series.map((s) => (
                    <td key={s.key} className="py-1 pr-3 text-right tabular-nums">
                      {format(s.values[i] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : empty ? (
        <div
          className="grid place-items-center rounded-xl border border-dashed border-border text-sm text-muted-foreground"
          style={{ height: H * 0.6 }}
        >
          Sem dados no período
        </div>
      ) : (
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            role="img"
            aria-label={title}
            onMouseLeave={() => setHover(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={pad.l}
                  x2={W - pad.r}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--border)"
                  strokeWidth={1}
                />
                <text
                  x={pad.l - 8}
                  y={y(t) + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--muted-fg)"
                >
                  {format(t)}
                </text>
              </g>
            ))}
            {labels.map((l, i) =>
              i % labelEvery === 0 ? (
                <text
                  key={l}
                  x={pad.l + step * i + step / 2}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--muted-fg)"
                >
                  {l}
                </text>
              ) : null,
            )}
            {type === 'bar'
              ? series.map((s, si) =>
                  s.values.map((v, i) => {
                    const x = pad.l + step * i + (step - groupW) / 2 + si * (barW + 2);
                    const h = Math.max(0, y(0) - y(v));
                    return (
                      <path
                        key={`${s.key}-${i}`}
                        d={
                          h > 0
                            ? `M${x},${y(0)} v${-Math.max(0, h - 4)} q0,-4 4,-4 h${barW - 8} q4,0 4,4 v${Math.max(0, h - 4)} z`
                            : ''
                        }
                        fill={COLORS[si]}
                        opacity={hover == null || hover === i ? 1 : 0.45}
                      />
                    );
                  }),
                )
              : series.map((s, si) => (
                  <g key={s.key}>
                    <polyline
                      fill="none"
                      stroke={COLORS[si]}
                      strokeWidth={2}
                      strokeLinejoin="round"
                      points={s.values
                        .map((v, i) => `${pad.l + step * i + step / 2},${y(v)}`)
                        .join(' ')}
                    />
                    {hover != null && s.values[hover] != null && (
                      <circle
                        cx={pad.l + step * hover + step / 2}
                        cy={y(s.values[hover]!)}
                        r={4.5}
                        fill={COLORS[si]}
                        stroke="var(--surface)"
                        strokeWidth={2}
                      />
                    )}
                  </g>
                ))}
            {type === 'line' && hover != null && (
              <line
                x1={pad.l + step * hover + step / 2}
                x2={pad.l + step * hover + step / 2}
                y1={pad.t}
                y2={y(0)}
                stroke="var(--muted-fg)"
                strokeDasharray="3 3"
              />
            )}
            {labels.map((l, i) => (
              <rect
                key={`hit-${l}`}
                x={pad.l + step * i}
                y={pad.t}
                width={step}
                height={ih}
                fill="transparent"
                role="img"
                tabIndex={0}
                aria-label={`${l}: ${series.map((s) => `${s.label} ${format(s.values[i] ?? 0)}`).join(', ')}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            ))}
          </svg>
          {hover != null && (
            <div
              className="pointer-events-none absolute top-0 z-10 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg"
              style={{ left: `${Math.min(80, ((pad.l + step * hover + step / 2) / W) * 100)}%` }}
              role="status"
            >
              <p className="font-semibold">{labels[hover]}</p>
              {series.map((s, i) => (
                <p key={s.key} className="flex items-center gap-1.5 tabular-nums">
                  <span
                    className="inline-block size-2 rounded-sm"
                    style={{ background: COLORS[i] }}
                    aria-hidden
                  />
                  {s.label}: {format(s.values[hover] ?? 0)}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

export function monthLabel(key: string) {
  const [y, m] = key.split('-');
  const month = new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString('pt-BR', { month: 'short' })
    .replace('.', '');
  return `${month}/${String(y).slice(2)}`;
}
