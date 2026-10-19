import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import type { PaymentDto } from '@azhoot/contracts';
import { Button, ConfirmDialog, EmptyState, ErrorState, Input, Select, Skeleton } from '@azhoot/ui';
import { PageHeader } from '@/components/layout/AdminLayout';
import { api, describeError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import {
  brl,
  formatDate,
  Kpi,
  Pager,
  PaymentStatusBadge,
  PLAN_NAMES,
  Table,
  td,
  th,
} from './shared';

interface Resp {
  total: number;
  page: number;
  pageSize: number;
  items: PaymentDto[];
  totals: Record<string, { cents: number; count: number }>;
}

const STATUS_OPTIONS = [
  ['ALL', 'Todos'],
  ['PENDING', 'Aguardando pagamento'],
  ['PAID', 'Pagos'],
  ['OVERDUE', 'Vencidos'],
  ['CANCELED', 'Cancelados'],
  ['REFUNDED', 'Estornados'],
] as const;

export default function MasterRevenue() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('ALL');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [confirm, setConfirm] = useState<PaymentDto | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [status, from, to, debounced]);

  const q = useQuery({
    queryKey: ['master', 'payments', { status, from, to, page, debounced }],
    queryFn: () =>
      api<Resp>(
        `/master/payments?${new URLSearchParams({
          status,
          page: String(page),
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
          ...(debounced ? { search: debounced } : {}),
        })}`,
      ),
    placeholderData: keepPreviousData,
  });
  const mark = useMutation({
    mutationFn: (id: string) => api(`/master/payments/${id}/mark-paid`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['master'] });
      setConfirm(null);
      toast.success('Pagamento confirmado.');
    },
    onError: (e) => toast.error(describeError(e)),
  });

  const t = q.data?.totals ?? {};
  const get = (...k: string[]) =>
    k.reduce(
      (a, s) => ({ cents: a.cents + (t[s]?.cents ?? 0), count: a.count + (t[s]?.count ?? 0) }),
      { cents: 0, count: 0 },
    );
  const generated = get('PENDING', 'CONFIRMED', 'RECEIVED', 'OVERDUE', 'CANCELED', 'REFUNDED');
  const paid = get('CONFIRMED', 'RECEIVED');
  const pending = get('PENDING');
  const overdue = get('OVERDUE');
  const canceled = get('CANCELED', 'REFUNDED');

  return (
    <>
      <PageHeader
        title="Receitas"
        description="Todas as cobranças geradas: pagas, aguardando, vencidas, canceladas e estornadas."
      />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <Kpi label="Geradas" value={brl(generated.cents)} hint={`${generated.count} cobranças`} />
        <Kpi
          label="Pagas"
          value={brl(paid.cents)}
          hint={`${paid.count} cobranças`}
          tone="success"
        />
        <Kpi label="Aguardando" value={brl(pending.cents)} hint={`${pending.count} cobranças`} />
        <Kpi
          label="Vencidas"
          value={brl(overdue.cents)}
          hint={`${overdue.count} cobranças`}
          tone={overdue.count ? 'warning' : undefined}
        />
        <Kpi
          label="Canceladas/estornos"
          value={brl(canceled.cents)}
          hint={`${canceled.count} cobranças`}
        />
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto]">
        <label className="relative">
          <span className="sr-only">Buscar por conta</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por conta"
            className="pl-9"
          />
        </label>
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">De</span>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            aria-label="Vencimento a partir de"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">até</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            aria-label="Vencimento até"
          />
        </label>
      </div>

      {q.isPending ? (
        <Skeleton className="h-96" />
      ) : q.isError ? (
        <ErrorState description={describeError(q.error)} />
      ) : q.data.items.length === 0 ? (
        <EmptyState
          title="Nenhuma cobrança"
          description="As cobranças aparecem aqui quando clientes contratam planos."
        />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <th className={th}>Vencimento</th>
                <th className={th}>Conta</th>
                <th className={th}>Plano</th>
                <th className={`${th} text-right`}>Valor</th>
                <th className={th}>Status</th>
                <th className={th}>Pago em</th>
                <th className={th}>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.data.items.map((p) => (
                <tr key={p.id}>
                  <td className={td}>{formatDate(p.dueDate)}</td>
                  <td className={td}>
                    {p.accountId ? (
                      <Link
                        to={`/master/usuarios/${p.accountId}`}
                        className="font-medium hover:underline"
                      >
                        {p.accountName}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">{p.accountName} (excluída)</span>
                    )}
                    {p.billingType && (
                      <p className="text-xs text-muted-foreground">{p.billingType}</p>
                    )}
                  </td>
                  <td className={td}>{PLAN_NAMES[p.planId] ?? p.planId}</td>
                  <td className={`${td} text-right tabular-nums`}>{brl(p.amountCents)}</td>
                  <td className={td}>
                    <PaymentStatusBadge status={p.status} />
                  </td>
                  <td className={`${td} text-xs`}>{formatDateTime(p.paidAt)}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    {p.invoiceUrl && (
                      <a
                        href={p.invoiceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mr-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        Fatura <ExternalLink className="size-3" aria-hidden />
                      </a>
                    )}
                    {(p.status === 'PENDING' || p.status === 'OVERDUE') && (
                      <Button size="sm" variant="outline" onClick={() => setConfirm(p)}>
                        Marcar pago
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pager
            page={q.data.page}
            pageSize={q.data.pageSize}
            total={q.data.total}
            onPage={setPage}
          />
        </>
      )}
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Confirmar recebimento manual?"
        description={
          confirm
            ? `${confirm.accountName}: ${brl(confirm.amountCents)} será marcado como recebido e o plano liberado.`
            : ''
        }
        confirmLabel="Confirmar"
        loading={mark.isPending}
        onConfirm={() => confirm && mark.mutate(confirm.id)}
      />
    </>
  );
}
