import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Snowflake, TrendingUp, UserPlus, Users, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { PaymentDto } from '@azhoot/contracts';
import { Card, CardContent, CardHeader, CardTitle, ErrorState, Skeleton } from '@azhoot/ui';
import { Chart, monthLabel } from '@/components/charts/Chart';
import { PageHeader } from '@/components/layout/AdminLayout';
import { api, describeError } from '@/lib/api';
import {
  brl,
  brlShort,
  formatDate,
  Kpi,
  PaymentStatusBadge,
  PLAN_NAMES,
  PlanBadge,
  Table,
  td,
  th,
} from './shared';

interface Dashboard {
  mrrCents: number;
  arrCents: number;
  payingAccounts: number;
  totalAccounts: number;
  byPlan: Record<string, number>;
  pastDue: number;
  frozen: number;
  signups30: number;
  revenueMonthCents: number;
  pending: { cents: number; count: number };
  overdue: { cents: number; count: number };
  commissionsPending: { cents: number; count: number };
  recentAccounts: {
    id: string;
    name: string;
    ownerName: string | null;
    ownerEmail: string | null;
    planId: string;
    createdAt: string;
  }[];
  recentPayments: PaymentDto[];
  series: {
    month: string;
    revenueCents: number;
    expensesCents: number;
    mrrCents: number;
    signups: number;
    newPaying: number;
  }[];
}

export default function MasterDashboard() {
  const q = useQuery({
    queryKey: ['master', 'dashboard'],
    queryFn: () => api<Dashboard>('/master/dashboard'),
  });
  if (q.isPending)
    return (
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    );
  if (q.isError) return <ErrorState description={describeError(q.error)} />;
  const d = q.data;
  const labels = d.series.map((s) => monthLabel(s.month));

  return (
    <>
      <PageHeader
        title="Visão geral"
        description="Saúde do negócio em tempo real: receita recorrente, clientes e cobranças."
      />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Kpi
          icon={<TrendingUp className="size-3.5" aria-hidden />}
          label="MRR"
          value={brl(d.mrrCents)}
          hint={`ARR ${brl(d.arrCents)}`}
        />
        <Kpi
          icon={<Wallet className="size-3.5" aria-hidden />}
          label="Recebido no mês"
          value={brl(d.revenueMonthCents)}
          hint={`${d.pending.count} cobranças em aberto (${brl(d.pending.cents)})`}
        />
        <Kpi
          icon={<Users className="size-3.5" aria-hidden />}
          label="Contas"
          value={d.totalAccounts.toLocaleString('pt-BR')}
          hint={`${d.payingAccounts} pagantes · ${d.byPlan.FREE ?? 0} grátis`}
        />
        <Kpi
          icon={<UserPlus className="size-3.5" aria-hidden />}
          label="Cadastros (30 dias)"
          value={d.signups30.toLocaleString('pt-BR')}
        />
        <Kpi
          icon={<AlertTriangle className="size-3.5" aria-hidden />}
          label="Em atraso"
          value={d.pastDue}
          tone={d.pastDue ? 'warning' : undefined}
          hint={`${d.overdue.count} cobranças vencidas (${brl(d.overdue.cents)})`}
        />
        <Kpi
          icon={<Snowflake className="size-3.5" aria-hidden />}
          label="Congeladas"
          value={d.frozen}
          tone={d.frozen ? 'danger' : undefined}
          hint="Mais de 5 dias sem pagamento"
        />
        <Kpi
          label="Planos pagos"
          value={`${d.byPlan.MONTHLY ?? 0} / ${d.byPlan.YEARLY ?? 0}`}
          hint="Mensal / Anual"
        />
        <Kpi
          label="Comissões a pagar"
          value={brl(d.commissionsPending.cents)}
          hint={
            <Link to="/master/afiliados" className="text-primary hover:underline">
              {d.commissionsPending.count} pendentes →
            </Link>
          }
        />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardContent className="pt-5">
            <Chart
              title="MRR (últimos 12 meses)"
              type="line"
              labels={labels}
              series={[{ key: 'mrr', label: 'MRR', values: d.series.map((s) => s.mrrCents) }]}
              format={brlShort}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <Chart
              title="Receita × despesas"
              labels={labels}
              series={[
                { key: 'rev', label: 'Receita', values: d.series.map((s) => s.revenueCents) },
                { key: 'exp', label: 'Despesas', values: d.series.map((s) => s.expensesCents) },
              ]}
              format={brlShort}
            />
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Novas contas</CardTitle>
            <Link to="/master/usuarios" className="text-sm text-primary hover:underline">
              Ver todas
            </Link>
          </CardHeader>
          <CardContent>
            <Table compact>
              <thead>
                <tr>
                  <th className={th}>Conta</th>
                  <th className={th}>Plano</th>
                  <th className={th}>Cadastro</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.recentAccounts.map((a) => (
                  <tr key={a.id}>
                    <td className={td}>
                      <Link to={`/master/usuarios/${a.id}`} className="font-medium hover:underline">
                        {a.name}
                      </Link>
                      <p className="text-xs text-muted-foreground">{a.ownerEmail}</p>
                    </td>
                    <td className={td}>
                      <PlanBadge planId={a.planId} />
                    </td>
                    <td className={td}>{formatDate(a.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Últimas cobranças</CardTitle>
            <Link to="/master/receitas" className="text-sm text-primary hover:underline">
              Ver receitas
            </Link>
          </CardHeader>
          <CardContent>
            {d.recentPayments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma cobrança ainda.</p>
            ) : (
              <Table compact>
                <thead>
                  <tr>
                    <th className={th}>Conta</th>
                    <th className={th}>Valor</th>
                    <th className={th}>Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {d.recentPayments.map((p) => (
                    <tr key={p.id}>
                      <td className={td}>
                        {p.accountName}
                        <p className="text-xs text-muted-foreground">
                          {PLAN_NAMES[p.planId]} · vence {formatDate(p.dueDate)}
                        </p>
                      </td>
                      <td className={`${td} tabular-nums`}>{brl(p.amountCents)}</td>
                      <td className={td}>
                        <PaymentStatusBadge status={p.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
