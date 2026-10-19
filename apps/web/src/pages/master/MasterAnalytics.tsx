import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  Input,
  Select,
  Skeleton,
} from '@azhoot/ui';
import { Chart, monthLabel } from '@/components/charts/Chart';
import { PageHeader } from '@/components/layout/AdminLayout';
import { api, describeError } from '@/lib/api';
import { brl, brlShort, monthsAgoISO, PLAN_NAMES, ratio, todayISO } from './shared';
import { EXPENSE_CATEGORIES } from './MasterExpenses';

interface Analytics {
  period: { from: string; to: string; months: number };
  mrrCents: number;
  arrCents: number;
  arpaCents: number | null;
  payingAccounts: number;
  revenueCents: number;
  netRevenueCents: number;
  expensesCents: number;
  marketingCents: number;
  commissionsCents: number;
  profitCents: number;
  roi: number | null;
  roas: number | null;
  cacCents: number | null;
  ltvCents: number | null;
  ltvCacRatio: number | null;
  churnRate: number | null;
  churnedAccounts: number;
  signups: number;
  newPaying: number;
  conversionRate: number | null;
  activeAccounts: number;
  sessions: number;
  participants: number;
  answers: number;
  avgParticipantsPerSession: number | null;
  pendingCents: number;
  overdueCents: number;
  pastDueAccounts: number;
  frozenAccounts: number;
  perPlan: Record<string, { accounts: number; mrrCents: number }>;
  expensesByCategory: Record<string, number>;
  series: {
    month: string;
    revenueCents: number;
    expensesCents: number;
    marketingCents: number;
    signups: number;
    newPaying: number;
    churned: number;
    mrrCents: number;
  }[];
}

const x = (v: number | null, d = 2) =>
  v == null ? '—' : `${v.toLocaleString('pt-BR', { maximumFractionDigits: d })}×`;

function Metric({
  label,
  value,
  help,
  tone,
}: {
  label: string;
  value: string;
  help: string;
  tone?: 'good' | 'bad';
}) {
  return (
    <div className="grid gap-1 rounded-2xl border border-border bg-surface p-4">
      <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
        <span title={help} className="cursor-help" aria-hidden>
          <Info className="size-3.5" />
        </span>
      </p>
      <p
        className={`font-display text-xl font-bold tabular-nums sm:text-2xl ${tone === 'good' ? 'text-success-strong dark:text-green-300' : tone === 'bad' ? 'text-red-700 dark:text-red-300' : ''}`}
      >
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{help}</p>
    </div>
  );
}

const PRESETS = [
  ['3', 'Últimos 3 meses'],
  ['6', 'Últimos 6 meses'],
  ['12', 'Últimos 12 meses'],
  ['24', 'Últimos 24 meses'],
  ['custom', 'Personalizado'],
] as const;

export default function MasterAnalytics() {
  const [preset, setPreset] = useState('12');
  const [from, setFrom] = useState(monthsAgoISO(12));
  const [to, setTo] = useState(todayISO());
  const f = preset === 'custom' ? from : monthsAgoISO(Number(preset));
  const t = preset === 'custom' ? to : todayISO();
  const q = useQuery({
    queryKey: ['master', 'analytics', f, t],
    queryFn: () => api<Analytics>(`/master/analytics?${new URLSearchParams({ from: f, to: t })}`),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Analíticos"
        description="Indicadores de receita recorrente, aquisição, retenção e retorno."
      />
      <div className="mb-5 flex flex-wrap items-center gap-3 text-sm">
        <Select
          aria-label="Período"
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          className="w-auto"
        >
          {PRESETS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </Select>
        {preset === 'custom' && (
          <>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="Data inicial"
              className="w-auto"
            />
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-label="Data final"
              className="w-auto"
            />
          </>
        )}
      </div>
      {q.isPending ? (
        <Skeleton className="h-[600px]" />
      ) : q.isError ? (
        <ErrorState description={describeError(q.error)} />
      ) : (
        <Body a={q.data} />
      )}
    </>
  );
}

function Body({ a }: { a: Analytics }) {
  const labels = a.series.map((s) => monthLabel(s.month));
  return (
    <div className="grid gap-6">
      <section aria-labelledby="h-rec" className="grid gap-3">
        <h2 id="h-rec" className="font-display text-lg font-semibold">
          Receita recorrente
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Metric
            label="MRR"
            value={brl(a.mrrCents)}
            help="Receita recorrente mensal atual (anual ÷ 12). Exclui gratuitos, cortesias e congelados."
          />
          <Metric label="ARR" value={brl(a.arrCents)} help="Receita recorrente anual: MRR × 12." />
          <Metric
            label="ARPA"
            value={brl(a.arpaCents)}
            help={`Receita média por conta pagante (${a.payingAccounts} pagantes).`}
          />
          <Metric
            label="Churn rate"
            value={ratio(a.churnRate, 2)}
            tone={a.churnRate != null && a.churnRate > 0.05 ? 'bad' : undefined}
            help={`Média mensal de contas pagas que cancelaram ou excluíram (${a.churnedAccounts} no período).`}
          />
        </div>
      </section>

      <section aria-labelledby="h-aq" className="grid gap-3">
        <h2 id="h-aq" className="font-display text-lg font-semibold">
          Aquisição e retorno
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Metric
            label="CAC"
            value={brl(a.cacCents)}
            help={`Custo de aquisição: marketing (${brl(a.marketingCents)}) ÷ novos pagantes (${a.newPaying}).`}
          />
          <Metric
            label="LTV"
            value={brl(a.ltvCents)}
            help="Valor do cliente no tempo: ARPA ÷ churn mensal."
          />
          <Metric
            label="LTV / CAC"
            value={x(a.ltvCacRatio, 1)}
            tone={
              a.ltvCacRatio == null
                ? undefined
                : a.ltvCacRatio >= 3
                  ? 'good'
                  : a.ltvCacRatio < 1
                    ? 'bad'
                    : undefined
            }
            help="Saudável acima de 3×."
          />
          <Metric
            label="ROAS"
            value={x(a.roas)}
            tone={a.roas == null ? undefined : a.roas >= 1 ? 'good' : 'bad'}
            help="Receita dos novos pagantes ÷ investimento em marketing."
          />
          <Metric
            label="ROI"
            value={ratio(a.roi)}
            tone={a.roi == null ? undefined : a.roi >= 0 ? 'good' : 'bad'}
            help="(Receita − despesas − comissões) ÷ (despesas + comissões)."
          />
          <Metric
            label="Conversão"
            value={ratio(a.conversionRate)}
            help={`Cadastros que viraram pagantes: ${a.newPaying} de ${a.signups}.`}
          />
          <Metric
            label="Lucro no período"
            value={brl(a.profitCents)}
            tone={a.profitCents >= 0 ? 'good' : 'bad'}
            help={`Receita ${brl(a.revenueCents)} − despesas ${brl(a.expensesCents)} − comissões ${brl(a.commissionsCents)}.`}
          />
          <Metric
            label="Receita líquida"
            value={brl(a.netRevenueCents)}
            help="Recebido após taxas do meio de pagamento."
          />
        </div>
      </section>

      <section aria-labelledby="h-kpi" className="grid gap-3">
        <h2 id="h-kpi" className="font-display text-lg font-semibold">
          KPIs de produto e cobrança
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Metric
            label="Contas ativas"
            value={a.activeAccounts.toLocaleString('pt-BR')}
            help="Contas que realizaram sessões no período."
          />
          <Metric
            label="Sessões"
            value={a.sessions.toLocaleString('pt-BR')}
            help={`${a.participants.toLocaleString('pt-BR')} participantes · ${a.answers.toLocaleString('pt-BR')} respostas.`}
          />
          <Metric
            label="Média por sessão"
            value={
              a.avgParticipantsPerSession == null
                ? '—'
                : a.avgParticipantsPerSession.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
            }
            help="Participantes por sessão."
          />
          <Metric
            label="Inadimplência"
            value={brl(a.overdueCents)}
            tone={a.overdueCents ? 'bad' : undefined}
            help={`${a.pastDueAccounts} em atraso · ${a.frozenAccounts} congeladas · ${brl(a.pendingCents)} a vencer.`}
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardContent className="pt-5">
            <Chart
              title="Evolução do MRR"
              type="line"
              labels={labels}
              series={[{ key: 'mrr', label: 'MRR', values: a.series.map((s) => s.mrrCents) }]}
              format={brlShort}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <Chart
              title="Receita × despesas × marketing"
              labels={labels}
              series={[
                { key: 'rev', label: 'Receita', values: a.series.map((s) => s.revenueCents) },
                { key: 'exp', label: 'Despesas', values: a.series.map((s) => s.expensesCents) },
                { key: 'mkt', label: 'Marketing', values: a.series.map((s) => s.marketingCents) },
              ]}
              format={brlShort}
            />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5">
            <Chart
              title="Cadastros, novos pagantes e cancelamentos"
              labels={labels}
              series={[
                { key: 'sig', label: 'Cadastros', values: a.series.map((s) => s.signups) },
                { key: 'np', label: 'Novos pagantes', values: a.series.map((s) => s.newPaying) },
                { key: 'ch', label: 'Cancelamentos', values: a.series.map((s) => s.churned) },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>MRR por plano e despesas por categoria</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 sm:grid-cols-2">
            <ul className="grid content-start gap-2 text-sm">
              {Object.entries(a.perPlan).length === 0 && (
                <li className="text-muted-foreground">Sem pagantes.</li>
              )}
              {Object.entries(a.perPlan).map(([id, p]) => (
                <li key={id} className="flex justify-between gap-2">
                  <span>
                    {PLAN_NAMES[id] ?? id}{' '}
                    <span className="text-muted-foreground">({p.accounts})</span>
                  </span>
                  <span className="tabular-nums">{brl(p.mrrCents)}</span>
                </li>
              ))}
            </ul>
            <ul className="grid content-start gap-2 text-sm">
              {Object.entries(a.expensesByCategory).length === 0 && (
                <li className="text-muted-foreground">Sem despesas.</li>
              )}
              {Object.entries(a.expensesByCategory).map(([k, v]) => (
                <li key={k} className="flex justify-between gap-2">
                  <span>{EXPENSE_CATEGORIES[k as keyof typeof EXPENSE_CATEGORIES] ?? k}</span>
                  <span className="tabular-nums">{brl(v)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
