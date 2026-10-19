import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, EmptyState, ErrorState, Input, Select, Skeleton } from '@azhoot/ui';
import { PageHeader } from '@/components/layout/AdminLayout';
import { api, describeError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { brl, formatDate, Pager, PlanBadge, SUB_STATUS, Table, td, th } from './shared';

interface AccountRow {
  id: string;
  name: string;
  active: boolean;
  planId: string;
  subscriptionStatus: string;
  billingExempt: boolean;
  affiliateEnabled: boolean;
  currentPeriodEnd: string | null;
  mrrCents: number;
  owner: {
    id: string;
    name: string;
    email: string;
    lastLoginAt: string | null;
    isMaster: boolean;
  } | null;
  counts: { quizzes: number; users: number; sessions: number; referrals: number };
  createdAt: string;
}

export default function MasterAccounts() {
  const [params, setParams] = useSearchParams();
  const plan = params.get('plano') ?? 'ALL';
  const status = params.get('status') ?? 'ALL';
  const page = Number(params.get('pagina') ?? 1);
  const [search, setSearch] = useState(params.get('busca') ?? '');
  const [debounced, setDebounced] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v && v !== 'ALL') next.set(k, v);
    else next.delete(k);
    if (k !== 'pagina') next.delete('pagina');
    setParams(next, { replace: true });
  };

  const q = useQuery({
    queryKey: ['master', 'accounts', { plan, status, page, debounced }],
    queryFn: () =>
      api<{ total: number; page: number; pageSize: number; items: AccountRow[] }>(
        `/master/accounts?${new URLSearchParams({ plan, status, page: String(page), ...(debounced ? { search: debounced } : {}) })}`,
      ),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Usuários"
        description="Todas as contas da plataforma: dados, plano, pagamentos e modo afiliado."
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
        <label className="relative">
          <span className="sr-only">Buscar por nome ou e-mail</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por conta, nome ou e-mail"
            className="pl-9"
          />
        </label>
        <Select aria-label="Plano" value={plan} onChange={(e) => set('plano', e.target.value)}>
          <option value="ALL">Todos os planos</option>
          <option value="FREE">Gratuito</option>
          <option value="MONTHLY">Mensal</option>
          <option value="YEARLY">Anual</option>
        </Select>
        <Select
          aria-label="Situação"
          value={status}
          onChange={(e) => set('status', e.target.value)}
        >
          <option value="ALL">Todas as situações</option>
          <option value="ACTIVE">Em dia</option>
          <option value="PAST_DUE">Em atraso</option>
          <option value="FROZEN">Congeladas</option>
          <option value="INACTIVE">Inativas</option>
          <option value="AFFILIATE">Afiliados</option>
        </Select>
      </div>

      {q.isPending ? (
        <Skeleton className="h-96" />
      ) : q.isError ? (
        <ErrorState description={describeError(q.error)} />
      ) : q.data.items.length === 0 ? (
        <EmptyState title="Nenhuma conta encontrada" description="Ajuste a busca ou os filtros." />
      ) : (
        <>
          <p className="mb-2 text-sm text-muted-foreground">
            {q.data.total.toLocaleString('pt-BR')} contas
          </p>
          <Table>
            <thead>
              <tr>
                <th className={th}>Conta</th>
                <th className={th}>Plano</th>
                <th className={th}>Situação</th>
                <th className={`${th} text-right`}>MRR</th>
                <th className={`${th} text-right`}>Uso</th>
                <th className={th}>Último acesso</th>
                <th className={th}>Cadastro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {q.data.items.map((a) => {
                const st = SUB_STATUS[a.subscriptionStatus];
                return (
                  <tr key={a.id} className="hover:bg-muted/50">
                    <td className={td}>
                      <Link
                        to={`/master/usuarios/${a.id}`}
                        className="font-medium text-foreground hover:text-primary hover:underline"
                      >
                        {a.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {a.owner?.name} · {a.owner?.email}
                      </p>
                    </td>
                    <td className={td}>
                      <PlanBadge planId={a.planId} exempt={a.billingExempt} />
                    </td>
                    <td className={td}>
                      <span className="flex flex-wrap gap-1">
                        {!a.active ? (
                          <Badge variant="danger">Inativa</Badge>
                        ) : a.planId !== 'FREE' && st ? (
                          <Badge variant={st.variant}>{st.label}</Badge>
                        ) : (
                          <Badge variant="muted">—</Badge>
                        )}
                        {a.affiliateEnabled && (
                          <Badge variant="accent">Afiliado · {a.counts.referrals}</Badge>
                        )}
                        {a.owner?.isMaster && <Badge>Master</Badge>}
                      </span>
                    </td>
                    <td className={`${td} text-right tabular-nums`}>
                      {a.mrrCents ? brl(a.mrrCents) : '—'}
                    </td>
                    <td className={`${td} text-right text-xs text-muted-foreground tabular-nums`}>
                      {a.counts.quizzes} quizzes · {a.counts.users} usuários
                    </td>
                    <td className={`${td} text-xs`}>{formatDateTime(a.owner?.lastLoginAt)}</td>
                    <td className={`${td} text-xs`}>{formatDate(a.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
          <Pager
            page={q.data.page}
            pageSize={q.data.pageSize}
            total={q.data.total}
            onPage={(p) => set('pagina', String(p))}
          />
        </>
      )}
    </>
  );
}
