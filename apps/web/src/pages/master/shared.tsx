import type { ReactNode } from 'react';
import { formatBRL, PAYMENT_STATUS_LABELS, type PaymentStatusCode } from '@azhoot/contracts';
import { Badge, Card, CardContent, cn } from '@azhoot/ui';

export const PLAN_NAMES: Record<string, string> = {
  FREE: 'Gratuito',
  MONTHLY: 'Mensal',
  YEARLY: 'Anual',
};

export const SUB_STATUS: Record<
  string,
  { label: string; variant: 'success' | 'warning' | 'danger' | 'muted' }
> = {
  ACTIVE: { label: 'Em dia', variant: 'success' },
  PAST_DUE: { label: 'Em atraso', variant: 'warning' },
  FROZEN: { label: 'Congelada', variant: 'danger' },
};

export const pct = (bp: number) =>
  `${(bp / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
export const ratio = (v: number | null | undefined, digits = 1) =>
  v == null ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: digits })}%`;
export const brl = (c: number | null | undefined) => (c == null ? '—' : formatBRL(c));
export const brlShort = (c: number) =>
  (c / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    notation: c >= 1_000_000 ? 'compact' : 'standard',
    maximumFractionDigits: c >= 100_000 ? 0 : 2,
  });

export function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  // Datas puras (YYYY-MM-DD) não devem sofrer conversão de fuso.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return d.toLocaleDateString('pt-BR');
}

export function todayISO() {
  return new Date().toLocaleDateString('en-CA');
}

export function monthsAgoISO(n: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - n + 1, 1);
  return d.toLocaleDateString('en-CA');
}

const PAY_VARIANT: Record<string, 'success' | 'warning' | 'danger' | 'muted' | 'default'> = {
  PENDING: 'default',
  CONFIRMED: 'success',
  RECEIVED: 'success',
  OVERDUE: 'warning',
  CANCELED: 'muted',
  REFUNDED: 'danger',
};

export function PaymentStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={PAY_VARIANT[status] ?? 'muted'}>
      {PAYMENT_STATUS_LABELS[status as PaymentStatusCode] ?? status}
    </Badge>
  );
}

export function PlanBadge({ planId, exempt }: { planId: string; exempt?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant={planId === 'FREE' ? 'muted' : planId === 'YEARLY' ? 'accent' : 'default'}>
        {PLAN_NAMES[planId] ?? planId}
      </Badge>
      {exempt && <Badge variant="success">Cortesia</Badge>}
    </span>
  );
}

export function Kpi({
  label,
  value,
  hint,
  tone,
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'warning' | 'danger' | 'success';
  icon?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="grid gap-1 pt-5">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {icon}
          {label}
        </p>
        <p
          className={cn(
            'font-display text-xl font-bold tabular-nums sm:text-2xl',
            tone === 'warning' && 'text-warning-strong dark:text-amber-300',
            tone === 'danger' && 'text-red-700 dark:text-red-300',
            tone === 'success' && 'text-success-strong dark:text-green-300',
          )}
        >
          {value}
        </p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export function Table({
  children,
  className,
  compact,
}: {
  children: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn('overflow-x-auto rounded-xl border border-border', className)}>
      <table className={cn('w-full text-sm', !compact && 'min-w-[640px]')}>{children}</table>
    </div>
  );
}

export const th =
  'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground';
export const td = 'px-3 py-2 align-middle';

export function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav aria-label="Paginação" className="mt-3 flex items-center justify-end gap-2 text-sm">
      <button
        type="button"
        className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-50"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        Anterior
      </button>
      <span className="text-muted-foreground">
        {page} de {pages}
      </span>
      <button
        type="button"
        className="rounded-lg border border-border px-3 py-1.5 disabled:opacity-50"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Próxima
      </button>
    </nav>
  );
}

/** Converte "12,50" / "12.50" / "1.234,56" em centavos. */
export function parseMoney(s: string): number | null {
  const clean = s.trim().replace(/[R$\s]/g, '');
  if (!clean) return null;
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export const moneyInput = (c: number | null | undefined) =>
  c == null
    ? ''
    : (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
