import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, ExternalLink, KeyRound } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CREDIT_REASON_LABELS,
  PIX_KEY_LABELS,
  type PaymentDto,
  type PlanDto,
} from '@azhoot/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Field,
  Input,
  Select,
  Skeleton,
  Switch,
} from '@azhoot/ui';
import { PageHeader } from '@/components/layout/AdminLayout';
import { api, describeError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import {
  brl,
  formatDate,
  moneyInput,
  parseMoney,
  PaymentStatusBadge,
  pct,
  PLAN_NAMES,
  PlanBadge,
  SUB_STATUS,
  Table,
  td,
  th,
} from './shared';

interface Detail {
  account: {
    id: string;
    name: string;
    active: boolean;
    planId: string;
    planName: string;
    subscriptionStatus: string;
    billingExempt: boolean;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    pendingPlanId: string | null;
    pendingChangeAt: string | null;
    frozenAt: string | null;
    firstPaidAt: string | null;
    createdAt: string;
    billing: {
      name: string | null;
      document: string | null;
      email: string | null;
      phone: string | null;
    };
    asaasCustomerId: string | null;
    asaasSubscriptionId: string | null;
    overrides: {
      maxQuizzes: number | null;
      unlimitedQuizzes: boolean;
      maxParticipants: number | null;
      maxUsers: number | null;
      priceCents: number | null;
    };
    effectiveLimits: { maxQuizzes: number | null; maxParticipants: number; maxUsers: number };
    effectivePriceCents: number;
    mrrCents: number;
    affiliate: {
      enabled: boolean;
      code: string | null;
      percentBp: number | null;
      effectivePercentBp: number;
      pixKeyType: string | null;
      pixKey: string | null;
    };
    referredBy: { id: string; name: string } | null;
    aiCreditsBalance: number;
  };
  usage: { quizzes: number; users: number };
  creditTransactions: {
    id: string;
    delta: number;
    balanceAfter: number;
    reason: string;
    note: string | null;
    createdAt: string;
  }[];
  plans: PlanDto[];
  users: {
    id: string;
    name: string;
    email: string;
    role: string;
    active: boolean;
    isMaster: boolean;
    lastLoginAt: string | null;
    createdAt: string;
  }[];
  payments: PaymentDto[];
  events: {
    id: string;
    type: string;
    fromPlanId: string | null;
    toPlanId: string | null;
    mrrDeltaCents: number;
    createdAt: string;
  }[];
  referrals: { id: string; name: string; planId: string; createdAt: string }[];
  commissions: {
    id: string;
    referredName: string;
    amountCents: number;
    baseAmountCents: number;
    percentBp: number;
    status: string;
    createdAt: string;
    paidAt: string | null;
    paidNote: string | null;
  }[];
}

const EVENT_LABELS: Record<string, string> = {
  SIGNUP: 'Cadastro',
  UPGRADE: 'Upgrade',
  DOWNGRADE: 'Downgrade',
  RENEW: 'Renovação',
  CANCEL: 'Cancelamento',
  FROZEN: 'Congelada',
  UNFROZEN: 'Descongelada',
  DELETED: 'Excluída',
  MASTER: 'Ajuste do master',
  EXEMPT_ON: 'Cortesia ativada',
  EXEMPT_OFF: 'Cortesia removida',
};
const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  PRESENTER: 'Apresentador',
};
const TABS = [
  { id: 'dados', label: 'Dados' },
  { id: 'pagamentos', label: 'Pagamentos' },
  { id: 'plano', label: 'Plano' },
  { id: 'afiliado', label: 'Afiliado' },
] as const;
type Tab = (typeof TABS)[number]['id'];

export default function MasterAccountDetail() {
  const { accountId = '' } = useParams();
  const [tab, setTab] = useState<Tab>('dados');
  const key = ['master', 'account', accountId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api<Detail>(`/master/accounts/${accountId}`),
  });

  if (q.isPending) return <Skeleton className="h-[480px]" />;
  if (q.isError) return <ErrorState description={describeError(q.error)} />;
  const d = q.data;
  const a = d.account;
  const st = SUB_STATUS[a.subscriptionStatus];

  return (
    <>
      <Link
        to="/master/usuarios"
        className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden /> Usuários
      </Link>
      <PageHeader
        title={a.name}
        description={`Cliente desde ${formatDate(a.createdAt)}${a.referredBy ? ` · indicado por ${a.referredBy.name}` : ''}`}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <PlanBadge planId={a.planId} exempt={a.billingExempt} />
            {!a.active && <Badge variant="danger">Inativa</Badge>}
            {a.planId !== 'FREE' && st && <Badge variant={st.variant}>{st.label}</Badge>}
          </span>
        }
      />
      <div
        role="tablist"
        aria-label="Seções da conta"
        className="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-muted p-1"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'min-h-10 flex-1 shrink-0 rounded-lg px-3 text-sm font-medium transition-colors',
              tab === t.id
                ? 'bg-surface text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'dados' && <DataTab d={d} />}
        {tab === 'pagamentos' && <PaymentsTab d={d} />}
        {tab === 'plano' && <PlanTab d={d} />}
        {tab === 'afiliado' && <AffiliateTab d={d} />}
      </div>
    </>
  );
}

function useInvalidate(accountId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['master', 'account', accountId] });
    void qc.invalidateQueries({ queryKey: ['master', 'accounts'] });
    void qc.invalidateQueries({ queryKey: ['master', 'dashboard'] });
  };
}

/* ---------------------------------- Dados --------------------------------- */

function DataTab({ d }: { d: Detail }) {
  const a = d.account;
  const invalidate = useInvalidate(a.id);
  const [confirmActive, setConfirmActive] = useState(false);
  const [resetFor, setResetFor] = useState<Detail['users'][number] | null>(null);
  const [temp, setTemp] = useState<{ email: string; temporaryPassword: string } | null>(null);
  const [name, setName] = useState(a.name);

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/master/accounts/${a.id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      invalidate();
      toast.success('Conta atualizada.');
      setConfirmActive(false);
    },
    onError: (e) => toast.error(describeError(e)),
  });
  const userActive = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      api(`/master/users/${id}`, { method: 'PATCH', body: { active } }),
    onSuccess: () => {
      invalidate();
      toast.success('Usuário atualizado.');
    },
    onError: (e) => toast.error(describeError(e)),
  });
  const reset = useMutation({
    mutationFn: (userId: string) =>
      api<{ email: string; temporaryPassword: string }>(`/master/accounts/${a.id}/reset-password`, {
        body: { userId, sendEmail: true },
      }),
    onSuccess: (r) => {
      setResetFor(null);
      setTemp(r);
    },
    onError: (e) => toast.error(describeError(e)),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px] [&>*]:min-w-0">
      <div className="grid gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Usuários da conta</CardTitle>
            <CardDescription>
              {d.usage.users} de {a.effectiveLimits.maxUsers} usuários ativos · {d.usage.quizzes}
              {a.effectiveLimits.maxQuizzes == null
                ? ' quizzes (ilimitado)'
                : ` de ${a.effectiveLimits.maxQuizzes} quizzes`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <thead>
                <tr>
                  <th className={th}>Nome</th>
                  <th className={th}>Perfil</th>
                  <th className={th}>Último acesso</th>
                  <th className={th}>Ativo</th>
                  <th className={th}>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.users.map((u) => (
                  <tr key={u.id}>
                    <td className={td}>
                      <p className="font-medium">
                        {u.name} {u.isMaster && <Badge className="ml-1">Master</Badge>}
                      </p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </td>
                    <td className={td}>{ROLE_LABELS[u.role] ?? u.role}</td>
                    <td className={`${td} text-xs`}>{formatDateTime(u.lastLoginAt)}</td>
                    <td className={td}>
                      <Switch
                        checked={u.active}
                        disabled={u.isMaster || userActive.isPending}
                        aria-label={`${u.active ? 'Inativar' : 'Ativar'} ${u.name}`}
                        onCheckedChange={(v) => userActive.mutate({ id: u.id, active: v })}
                      />
                    </td>
                    <td className={`${td} text-right`}>
                      <Button size="sm" variant="outline" onClick={() => setResetFor(u)}>
                        <KeyRound className="size-4" aria-hidden /> Resetar senha
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Histórico da assinatura</CardTitle>
          </CardHeader>
          <CardContent>
            {d.events.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem eventos.</p>
            ) : (
              <ol className="grid gap-2 text-sm">
                {d.events.map((e) => (
                  <li
                    key={e.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 last:border-0"
                  >
                    <span>
                      <span className="font-medium">{EVENT_LABELS[e.type] ?? e.type}</span>
                      {e.fromPlanId && e.toPlanId && e.fromPlanId !== e.toPlanId && (
                        <span className="text-muted-foreground">
                          {' '}
                          · {PLAN_NAMES[e.fromPlanId]} → {PLAN_NAMES[e.toPlanId]}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-3 text-xs text-muted-foreground">
                      {e.mrrDeltaCents !== 0 && (
                        <span
                          className={
                            e.mrrDeltaCents > 0
                              ? 'text-success-strong dark:text-green-300'
                              : 'text-red-700 dark:text-red-300'
                          }
                        >
                          MRR {e.mrrDeltaCents > 0 ? '+' : '−'}
                          {brl(Math.abs(e.mrrDeltaCents))}
                        </span>
                      )}
                      {formatDateTime(e.createdAt)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid content-start gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Conta</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <form
              className="flex items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim().length >= 2) patch.mutate({ name: name.trim() });
              }}
            >
              <Field id="acc-name" label="Nome da conta" className="flex-1">
                {(p) => (
                  <Input
                    {...p}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={120}
                  />
                )}
              </Field>
              <Button
                type="submit"
                variant="outline"
                disabled={name.trim() === a.name || patch.isPending}
              >
                Salvar
              </Button>
            </form>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
              <div>
                <p className="text-sm font-medium">{a.active ? 'Conta ativa' : 'Conta inativa'}</p>
                <p className="text-xs text-muted-foreground">
                  Inativar desconecta todos os usuários e bloqueia o login.
                </p>
              </div>
              <Switch
                checked={a.active}
                aria-label={a.active ? 'Inativar conta' : 'Ativar conta'}
                disabled={d.users.some((u) => u.isMaster)}
                onCheckedChange={(v) =>
                  v ? patch.mutate({ active: true }) : setConfirmActive(true)
                }
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Dados de cobrança</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-2 text-sm">
              {[
                ['Nome', a.billing.name],
                ['CPF/CNPJ', a.billing.document],
                ['E-mail', a.billing.email],
                ['Telefone', a.billing.phone],
                ['Cliente Asaas', a.asaasCustomerId],
                ['Assinatura Asaas', a.asaasSubscriptionId],
                ['Primeiro pagamento', formatDate(a.firstPaidAt)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="truncate text-right font-medium">{v || '—'}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <CreditsCard d={d} />
      </div>

      <ConfirmDialog
        open={confirmActive}
        onOpenChange={setConfirmActive}
        title="Inativar esta conta?"
        description="Todos os usuários serão desconectados e não conseguirão entrar até a conta ser reativada. Nenhum dado é apagado."
        confirmLabel="Inativar"
        destructive
        loading={patch.isPending}
        onConfirm={() => patch.mutate({ active: false })}
      />
      <ConfirmDialog
        open={!!resetFor}
        onOpenChange={(o) => !o && setResetFor(null)}
        title={`Resetar a senha de ${resetFor?.name ?? ''}?`}
        description="Uma senha temporária será gerada e enviada por e-mail. As sessões abertas desse usuário serão encerradas."
        confirmLabel="Resetar senha"
        loading={reset.isPending}
        onConfirm={() => resetFor && reset.mutate(resetFor.id)}
      />
      <Dialog open={!!temp} onOpenChange={(o) => !o && setTemp(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Senha temporária gerada</DialogTitle>
            <DialogDescription>
              Enviamos por e-mail para {temp?.email}. Ela é exibida apenas agora.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-xl bg-muted p-3 font-mono text-lg">
            <span className="flex-1 select-all break-all">{temp?.temporaryPassword}</span>
            <Button
              size="sm"
              variant="ghost"
              aria-label="Copiar senha"
              onClick={() => {
                void navigator.clipboard.writeText(temp?.temporaryPassword ?? '');
                toast.success('Copiada!');
              }}
            >
              <Copy className="size-4" aria-hidden />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setTemp(null)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* -------------------------------- Pagamentos ------------------------------ */

function PaymentsTab({ d }: { d: Detail }) {
  const invalidate = useInvalidate(d.account.id);
  const [confirm, setConfirm] = useState<PaymentDto | null>(null);
  const mark = useMutation({
    mutationFn: (id: string) => api(`/master/payments/${id}/mark-paid`, { method: 'POST' }),
    onSuccess: () => {
      invalidate();
      setConfirm(null);
      toast.success('Pagamento confirmado.');
    },
    onError: (e) => toast.error(describeError(e)),
  });
  const paid = d.payments
    .filter((p) => p.status === 'CONFIRMED' || p.status === 'RECEIVED')
    .reduce((s, p) => s + p.amountCents, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pagamentos</CardTitle>
        <CardDescription>Total pago: {brl(paid)}</CardDescription>
      </CardHeader>
      <CardContent>
        {d.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma cobrança gerada para esta conta.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <th className={th}>Vencimento</th>
                <th className={th}>Descrição</th>
                <th className={`${th} text-right`}>Valor</th>
                <th className={th}>Status</th>
                <th className={th}>Pago em</th>
                <th className={th}>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.payments.map((p) => (
                <tr key={p.id}>
                  <td className={td}>{formatDate(p.dueDate)}</td>
                  <td className={td}>
                    {p.description ?? PLAN_NAMES[p.planId]}
                    {p.billingType && (
                      <p className="text-xs text-muted-foreground">{p.billingType}</p>
                    )}
                  </td>
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
                        Marcar como pago
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardContent>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Confirmar recebimento manual?"
        description={
          confirm
            ? `A cobrança de ${brl(confirm.amountCents)} será marcada como recebida (no Asaas, "recebido em dinheiro") e o plano liberado.`
            : ''
        }
        confirmLabel="Confirmar recebimento"
        loading={mark.isPending}
        onConfirm={() => confirm && mark.mutate(confirm.id)}
      />
    </Card>
  );
}

/* ---------------------------------- Plano --------------------------------- */

function numOrNull(s: string) {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 ? n : NaN;
}

function PlanTab({ d }: { d: Detail }) {
  const a = d.account;
  const invalidate = useInvalidate(a.id);
  const [planId, setPlanId] = useState(a.planId);
  const [exempt, setExempt] = useState(a.billingExempt);
  const [confirmPlan, setConfirmPlan] = useState(false);
  const [o, setO] = useState({
    maxQuizzes: a.overrides.maxQuizzes?.toString() ?? '',
    unlimitedQuizzes: a.overrides.unlimitedQuizzes,
    maxParticipants: a.overrides.maxParticipants?.toString() ?? '',
    maxUsers: a.overrides.maxUsers?.toString() ?? '',
    price: moneyInput(a.overrides.priceCents),
  });
  const [error, setError] = useState<string | null>(null);
  const plan = d.plans.find((p) => p.id === a.planId);

  const setPlan = useMutation({
    mutationFn: () => api(`/master/accounts/${a.id}/plan`, { body: { planId, exempt } }),
    onSuccess: () => {
      invalidate();
      setConfirmPlan(false);
      toast.success('Plano aplicado.');
    },
    onError: (e) => toast.error(describeError(e)),
  });
  const saveOverrides = useMutation({
    mutationFn: (overrides: Record<string, unknown>) =>
      api(`/master/accounts/${a.id}`, { method: 'PATCH', body: { overrides } }),
    onSuccess: () => {
      invalidate();
      toast.success('Limites personalizados salvos.');
    },
    onError: (e) => setError(describeError(e)),
  });

  function submitOverrides(e: FormEvent) {
    e.preventDefault();
    const maxQuizzes = numOrNull(o.maxQuizzes);
    const maxParticipants = numOrNull(o.maxParticipants);
    const maxUsers = numOrNull(o.maxUsers);
    const priceCents = o.price.trim() ? parseMoney(o.price) : null;
    if ([maxQuizzes, maxParticipants, maxUsers].some((n) => Number.isNaN(n)))
      return setError('Use apenas números inteiros.');
    if (maxParticipants != null && (maxParticipants < 2 || maxParticipants > 200))
      return setError('Participantes: entre 2 e 200.');
    if (maxUsers != null && maxUsers < 1) return setError('Usuários: mínimo 1.');
    if (o.price.trim() && priceCents == null) return setError('Preço inválido.');
    setError(null);
    saveOverrides.mutate({
      maxQuizzes,
      unlimitedQuizzes: o.unlimitedQuizzes,
      maxParticipants,
      maxUsers,
      priceCents,
    });
  }

  const target = d.plans.find((p) => p.id === planId);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Plano atual</CardTitle>
          <CardDescription>
            {a.planName} ·{' '}
            {a.billingExempt
              ? 'cortesia (sem cobrança)'
              : a.effectivePriceCents
                ? brl(a.effectivePriceCents)
                : 'grátis'}
            {a.mrrCents > 0 && ` · MRR ${brl(a.mrrCents)}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <dl className="grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded-xl bg-muted p-3">
              <dt className="text-xs text-muted-foreground">Quizzes</dt>
              <dd className="font-display text-lg font-bold">
                {a.effectiveLimits.maxQuizzes ?? '∞'}
              </dd>
            </div>
            <div className="rounded-xl bg-muted p-3">
              <dt className="text-xs text-muted-foreground">Pessoas/sessão</dt>
              <dd className="font-display text-lg font-bold">
                {a.effectiveLimits.maxParticipants}
              </dd>
            </div>
            <div className="rounded-xl bg-muted p-3">
              <dt className="text-xs text-muted-foreground">Usuários</dt>
              <dd className="font-display text-lg font-bold">{a.effectiveLimits.maxUsers}</dd>
            </div>
          </dl>
          <dl className="grid gap-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Período atual</dt>
              <dd>
                {formatDate(a.currentPeriodStart)} → {formatDate(a.currentPeriodEnd)}
              </dd>
            </div>
            {a.pendingPlanId && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Mudança agendada</dt>
                <dd>
                  {PLAN_NAMES[a.pendingPlanId]} em {formatDate(a.pendingChangeAt)}
                </dd>
              </div>
            )}
            {a.frozenAt && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Congelada em</dt>
                <dd>{formatDate(a.frozenAt)}</dd>
              </div>
            )}
          </dl>
          <hr className="border-border" />
          <p className="text-sm font-semibold">Definir plano manualmente</p>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <Field id="set-plan" label="Plano">
              {(p) => (
                <Select {...p} value={planId} onChange={(e) => setPlanId(e.target.value)}>
                  {d.plans.map((pl) => (
                    <option key={pl.id} value={pl.id}>
                      {pl.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <Switch checked={exempt} onCheckedChange={setExempt} aria-label="Cortesia" /> Cortesia
              (sem cobrança)
            </label>
          </div>
          <Button
            onClick={() => setConfirmPlan(true)}
            disabled={planId === a.planId && exempt === a.billingExempt}
          >
            Aplicar agora
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Limites personalizados</CardTitle>
          <CardDescription>
            Sobrepõem o padrão global do plano apenas para esta conta. Deixe em branco para usar o
            global.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submitOverrides} noValidate>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                id="ov-q"
                label="Máx. de quizzes"
                hint={`Global: ${plan?.maxQuizzes ?? 'ilimitado'}`}
              >
                {(p) => (
                  <Input
                    {...p}
                    inputMode="numeric"
                    value={o.maxQuizzes}
                    disabled={o.unlimitedQuizzes}
                    onChange={(e) => setO({ ...o, maxQuizzes: e.target.value })}
                  />
                )}
              </Field>
              <label className="flex min-h-11 items-center gap-2 self-end text-sm">
                <Switch
                  checked={o.unlimitedQuizzes}
                  onCheckedChange={(v) => setO({ ...o, unlimitedQuizzes: v })}
                  aria-label="Quizzes ilimitados"
                />{' '}
                Quizzes ilimitados
              </label>
              <Field id="ov-p" label="Pessoas por sessão" hint={`Global: ${plan?.maxParticipants}`}>
                {(p) => (
                  <Input
                    {...p}
                    inputMode="numeric"
                    value={o.maxParticipants}
                    onChange={(e) => setO({ ...o, maxParticipants: e.target.value })}
                  />
                )}
              </Field>
              <Field id="ov-u" label="Usuários" hint={`Global: ${plan?.maxUsers}`}>
                {(p) => (
                  <Input
                    {...p}
                    inputMode="numeric"
                    value={o.maxUsers}
                    onChange={(e) => setO({ ...o, maxUsers: e.target.value })}
                  />
                )}
              </Field>
              {a.planId !== 'FREE' && (
                <Field
                  id="ov-price"
                  label="Preço especial (R$)"
                  hint={`Global: ${plan ? brl(plan.priceCents) : '—'} · vale para o plano atual e as próximas cobranças`}
                  className="sm:col-span-2"
                >
                  {(p) => (
                    <Input
                      {...p}
                      inputMode="decimal"
                      placeholder="Ex.: 7,90"
                      value={o.price}
                      onChange={(e) => setO({ ...o, price: e.target.value })}
                    />
                  )}
                </Field>
              )}
            </div>
            {error && <Alert variant="danger">{error}</Alert>}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={saveOverrides.isPending}>
                Salvar limites
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setO({
                    maxQuizzes: '',
                    unlimitedQuizzes: false,
                    maxParticipants: '',
                    maxUsers: '',
                    price: '',
                  });
                  saveOverrides.mutate({
                    maxQuizzes: null,
                    unlimitedQuizzes: false,
                    maxParticipants: null,
                    maxUsers: null,
                    priceCents: null,
                  });
                }}
              >
                Voltar ao padrão global
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <ConfirmDialog
        open={confirmPlan}
        onOpenChange={setConfirmPlan}
        title={`Aplicar ${target?.name ?? ''} agora?`}
        description={
          exempt
            ? 'A conta passa a este plano imediatamente, sem cobrança. Se exceder os limites, os quizzes/usuários mais antigos além do limite serão arquivados/desativados.'
            : 'A conta passa a este plano imediatamente e as próximas cobranças seguem o novo valor. Excedentes serão arquivados/desativados.'
        }
        confirmLabel="Aplicar"
        loading={setPlan.isPending}
        onConfirm={() => setPlan.mutate()}
      />
    </div>
  );
}

/* --------------------------------- Afiliado ------------------------------- */

function AffiliateTab({ d }: { d: Detail }) {
  const a = d.account;
  const aff = a.affiliate;
  const invalidate = useInvalidate(a.id);
  const [percent, setPercent] = useState(aff.percentBp != null ? String(aff.percentBp / 100) : '');
  useEffect(
    () => setPercent(aff.percentBp != null ? String(aff.percentBp / 100) : ''),
    [aff.percentBp],
  );
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api(`/master/accounts/${a.id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      invalidate();
      toast.success('Afiliado atualizado.');
    },
    onError: (e) => toast.error(describeError(e)),
  });
  const pay = useMutation({
    mutationFn: (ids: string[]) => api('/master/commissions/pay', { body: { ids } }),
    onSuccess: () => {
      invalidate();
      toast.success('Comissões marcadas como pagas.');
    },
    onError: (e) => toast.error(describeError(e)),
  });
  const link = aff.code ? `${window.location.origin}/cadastro?ref=${aff.code}` : null;
  const pending = d.commissions.filter((c) => c.status === 'PENDING');
  const sum = (s: string) =>
    d.commissions.filter((c) => c.status === s).reduce((t, c) => t + c.amountCents, 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] [&>*]:min-w-0">
      <Card>
        <CardHeader>
          <CardTitle>Modo afiliado</CardTitle>
          <CardDescription>
            O afiliado recebe um link exclusivo de cadastro e comissão sobre os pagamentos dos
            indicados.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 min-w-0">
          <label className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm font-medium">
            {aff.enabled ? 'Afiliado ativo' : 'Afiliado desativado'}
            <Switch
              checked={aff.enabled}
              onCheckedChange={(v) => patch.mutate({ affiliateEnabled: v })}
              aria-label="Modo afiliado"
            />
          </label>
          {aff.enabled && (
            <>
              {link && (
                <div className="grid gap-1 min-w-0">
                  <p className="text-xs font-semibold text-muted-foreground">Link exclusivo</p>
                  <div className="flex min-w-0 items-center gap-2 rounded-lg bg-muted p-2 text-xs">
                    <span className="min-w-0 flex-1 truncate font-mono">{link}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label="Copiar link"
                      onClick={() => {
                        void navigator.clipboard.writeText(link);
                        toast.success('Link copiado!');
                      }}
                    >
                      <Copy className="size-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              )}
              <form
                className="flex items-end gap-2 min-w-0"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = percent.trim() ? Number(percent.replace(',', '.')) : null;
                  if (v != null && (!Number.isFinite(v) || v < 0 || v > 100))
                    return toast.error('Percentual entre 0 e 100.');
                  patch.mutate({ affiliatePercentBp: v == null ? null : Math.round(v * 100) });
                }}
              >
                <Field
                  id="aff-pct"
                  label="Percentual (%)"
                  hint={`Em branco = global. Efetivo: ${pct(aff.effectivePercentBp)}`}
                  className="flex-1 min-w-0"
                >
                  {(p) => (
                    <Input
                      {...p}
                      inputMode="decimal"
                      value={percent}
                      onChange={(e) => setPercent(e.target.value)}
                      placeholder="Global"
                    />
                  )}
                </Field>
                <Button type="submit" variant="outline" loading={patch.isPending}>
                  Salvar
                </Button>
              </form>
              <div className="rounded-xl border border-border p-3 text-sm">
                <p className="text-xs font-semibold text-muted-foreground">
                  Conta PIX para repasse
                </p>
                {aff.pixKey ? (
                  <p className="mt-1 font-medium">
                    {PIX_KEY_LABELS[aff.pixKeyType as keyof typeof PIX_KEY_LABELS] ??
                      aff.pixKeyType}
                    : <span className="font-mono">{aff.pixKey}</span>
                  </p>
                ) : (
                  <p className="mt-1 text-muted-foreground">
                    O afiliado ainda não cadastrou a chave PIX.
                  </p>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid content-start gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border p-4">
            <p className="text-xs text-muted-foreground">Indicações</p>
            <p className="font-display text-xl font-bold">{d.referrals.length}</p>
          </div>
          <div className="rounded-xl border border-border p-4">
            <p className="text-xs text-muted-foreground">A pagar</p>
            <p className="font-display text-xl font-bold">{brl(sum('PENDING'))}</p>
          </div>
          <div className="rounded-xl border border-border p-4">
            <p className="text-xs text-muted-foreground">Já pago</p>
            <p className="font-display text-xl font-bold">{brl(sum('PAID'))}</p>
          </div>
        </div>
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Comissões</CardTitle>
            {pending.length > 0 && (
              <Button
                size="sm"
                loading={pay.isPending}
                onClick={() => pay.mutate(pending.map((c) => c.id))}
              >
                Marcar {pending.length} como pagas
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {d.commissions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma comissão gerada.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th className={th}>Indicado</th>
                    <th className={`${th} text-right`}>Pagamento</th>
                    <th className={`${th} text-right`}>Comissão</th>
                    <th className={th}>Status</th>
                    <th className={th}>Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {d.commissions.map((c) => (
                    <tr key={c.id}>
                      <td className={td}>{c.referredName}</td>
                      <td className={`${td} text-right tabular-nums`}>{brl(c.baseAmountCents)}</td>
                      <td className={`${td} text-right tabular-nums`}>
                        {brl(c.amountCents)}{' '}
                        <span className="text-xs text-muted-foreground">({pct(c.percentBp)})</span>
                      </td>
                      <td className={td}>
                        <Badge
                          variant={
                            c.status === 'PAID'
                              ? 'success'
                              : c.status === 'PENDING'
                                ? 'warning'
                                : 'muted'
                          }
                        >
                          {c.status === 'PAID'
                            ? 'Paga'
                            : c.status === 'PENDING'
                              ? 'A pagar'
                              : 'Cancelada'}
                        </Badge>
                      </td>
                      <td className={`${td} text-xs`}>{formatDate(c.paidAt ?? c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Indicados</CardTitle>
          </CardHeader>
          <CardContent>
            {d.referrals.length === 0 ? (
              <p className="text-sm text-muted-foreground">Ninguém se cadastrou pelo link ainda.</p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {d.referrals.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <Link to={`/master/usuarios/${r.id}`} className="hover:underline">
                      {r.name}
                    </Link>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <PlanBadge planId={r.planId} /> {formatDate(r.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------- Créditos IA ----------------------------- */

function CreditsCard({ d }: { d: Detail }) {
  const invalidate = useInvalidate(d.account.id);
  const [delta, setDelta] = useState('');
  const [note, setNote] = useState('');
  const adjust = useMutation({
    mutationFn: (n: number) =>
      api<{ balance: number }>(`/master/accounts/${d.account.id}/credits`, {
        body: { delta: n, note: note.trim() || undefined },
      }),
    onSuccess: () => {
      invalidate();
      setDelta('');
      setNote('');
      toast.success('Créditos ajustados.');
    },
    onError: (e) => toast.error(describeError(e)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(delta);
    if (!Number.isInteger(n) || n === 0) return toast.error('Informe um número diferente de zero.');
    adjust.mutate(n);
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          Créditos de IA
          <Badge variant="accent">{d.account.aiCreditsBalance} créditos</Badge>
        </CardTitle>
        <CardDescription>Ajuste manual (positivo credita, negativo debita).</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <form className="flex items-end gap-2" onSubmit={submit}>
          <Field id="cred-delta" label="Ajuste" className="w-28">
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                placeholder="+10 / -5"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
              />
            )}
          </Field>
          <Field id="cred-note" label="Observação" className="flex-1">
            {(p) => (
              <Input
                {...p}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
              />
            )}
          </Field>
          <Button type="submit" variant="outline" loading={adjust.isPending}>
            Aplicar
          </Button>
        </form>
        {d.creditTransactions.length > 0 && (
          <ul className="grid gap-1 text-xs">
            {d.creditTransactions.slice(0, 8).map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-2 border-b border-border pb-1 last:border-0"
              >
                <span>
                  <span
                    className={
                      t.delta >= 0
                        ? 'text-success-strong dark:text-green-300'
                        : 'text-red-700 dark:text-red-300'
                    }
                  >
                    {t.delta > 0 ? '+' : ''}
                    {t.delta}
                  </span>{' '}
                  <span className="text-muted-foreground">
                    {CREDIT_REASON_LABELS[t.reason] ?? t.reason}
                  </span>
                </span>
                <span className="text-muted-foreground">{formatDateTime(t.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
