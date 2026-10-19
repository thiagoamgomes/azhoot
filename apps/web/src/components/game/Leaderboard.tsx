import { Crown, Medal } from 'lucide-react';
import type { LeaderboardEntry } from '@azhoot/contracts';
import { cn } from '@azhoot/ui';
import { formatNumber } from '@/lib/format';

export function Leaderboard({
  entries,
  highlightId,
  className,
}: {
  entries: LeaderboardEntry[];
  highlightId?: string;
  className?: string;
}) {
  if (entries.length === 0)
    return (
      <p className="text-center text-slate-300">Ainda não há participantes na classificação.</p>
    );
  return (
    <ol className={cn('grid gap-[1.2vmin]', className)} aria-label="Classificação">
      {entries.map((e, i) => (
        <li
          key={e.participantId}
          className={cn(
            'flex items-center gap-[2vmin] rounded-2xl bg-white/10 px-[2.4vmin] py-[1.4vmin] text-[2.6vmin] font-semibold animate-rise',
            e.participantId === highlightId && 'ring-4 ring-blue-400',
          )}
          style={{ animationDelay: `${i * 40}ms` }}
        >
          <span className="w-[5vmin] text-center font-display font-bold text-blue-300">
            {e.rank}º
          </span>
          <span className="min-w-0 flex-1 truncate">{e.nickname}</span>
          <span className="font-display tabular-nums">{formatNumber(e.totalScore)}</span>
        </li>
      ))}
    </ol>
  );
}

const PODIUM_STYLE = [
  { h: 'h-[34vmin]', bg: 'bg-gradient-to-t from-blue-700 to-blue-500', icon: Crown },
  { h: 'h-[26vmin]', bg: 'bg-gradient-to-t from-slate-600 to-slate-400', icon: Medal },
  { h: 'h-[20vmin]', bg: 'bg-gradient-to-t from-violet-800 to-violet-600', icon: Medal },
];

/** Pódio com os três primeiros (empates compartilham a posição). */
export function Podium({ entries }: { entries: LeaderboardEntry[] }) {
  const byRank = [1, 2, 3].map((r) => entries.filter((e) => e.rank === r));
  const order = [1, 0, 2]; // 2º, 1º, 3º
  return (
    <div className="flex items-end justify-center gap-[2vmin]" aria-label="Pódio">
      {order.map((idx) => {
        const group = byRank[idx] ?? [];
        const style = PODIUM_STYLE[idx]!;
        const Icon = style.icon;
        return (
          <div key={idx} className="flex w-[24vmin] flex-col items-center gap-[1.4vmin]">
            <div className="grid min-h-[8vmin] content-end gap-1 text-center">
              {group.length === 0 ? (
                <span className="text-[2vmin] text-slate-400">—</span>
              ) : (
                group.map((e) => (
                  <span
                    key={e.participantId}
                    className="block truncate font-display text-[3vmin] font-bold"
                  >
                    {e.nickname}
                  </span>
                ))
              )}
              {group[0] && (
                <span className="text-[2.2vmin] tabular-nums text-blue-200">
                  {formatNumber(group[0].totalScore)} pts
                </span>
              )}
            </div>
            <div
              className={cn(
                'flex w-full flex-col items-center justify-start rounded-t-2xl pt-[2vmin] shadow-xl animate-rise',
                style.h,
                style.bg,
              )}
              style={{ animationDelay: `${(2 - idx) * 150}ms` }}
            >
              <Icon className="size-[5vmin] text-white/90" aria-hidden />
              <span className="font-display text-[6vmin] font-bold">{idx + 1}º</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
