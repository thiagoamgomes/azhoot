import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  CheckCircle2,
  Clock,
  Crown,
  ExternalLink,
  HeartCrack,
  Loader2,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  checkoutSchema,
  formatBRL,
  PAYMENT_STATUS_LABELS,
  PLAN_RANK,
  type PaymentDto,
  type PlanId,
  type PlanWithPrice,
} from '@azhoot/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorState,
  Field,
  Input,
  Skeleton,
} from '@azhoot/ui';
import { PageHeader } from '@/components/layout/AdminLayout';
import { api, ApiError, describeError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { BILLING_KEY, limitLabel, lossesBetween, priceLabel, useBilling } from '@/lib/billing';
import { formatDateTime } from '@/lib/format';

const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');

function PlanFeatures({ plan }: { plan: PlanWithPrice }) {
  const l = plan.effectiveLimits;
  const items = [
    limitLabel(l.maxQuizzes, 'quizzes'),
    `Até ${l.maxParticipants} pessoas por sessão`,
    l.maxUsers === 1 ? '1 usuário' : `${l.maxUsers} usuários`,
  ];
  const extra = plan.features.filter((f) => !/quizzes|pessoas|usu[aá]rio/i.test(f));
  return (
    <ul className="grid gap-2 text-sm">
      {[...items, ...extra].map((f) => (
        <li key={f} className="flex items-start gap-2">
          <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> {f}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------ checkout ------------------------------ */

function CheckoutDialog({ plan, onClose }: { plan: PlanWithPrice | null; onClose: () => void }) {
  const qc = useQueryClient();
  const { data } = useBilling();
  const { user } = useAuth();
  const [form, setForm] = useState({ billingName: '', billingDocument: '', billingPhone: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (plan && data)
      setForm({
        billingName: data.billing.name ?? user?.name ?? '',
        billingDocument: data.billing.document ?? '',
        billingPhone: data.billing.phone ?? '',
      });
  }, [plan, data, user]);
  const m = useMutation({
    mutationFn: () =>
      api<{ invoiceUrl: string | null; payment: PaymentDto | null }>('/account/checkout', {
        body: { planId: plan!.id, ...form },
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: BILLING_KEY });
      if (res.invoiceUrl) window.open(res.invoiceUrl, '_blank', 'noopener');
      else toast.success('Plano atualizado!');
      onClose();
    },
    onError: (e) =>
      setErrors(e instanceof ApiError ? { _: e.message, ...e.fields } : { _: describeError(e) }),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    const p = checkoutSchema.safeParse({ planId: plan!.id, ...form });
    if (!p.success) {
      const f: Record<string, string> = {};
      for (const i of p.error.issues) f[String(i.path[0])] ??= i.message;
      return setErrors(f);
    }
    setErrors({});
    m.mutate();
  }
  return (
    <Dialog open={!!plan} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Assinar o plano {plan?.name}</DialogTitle>
            <DialogDescription>
              {plan && priceLabel(plan)} · Pague por PIX, boleto ou cartão na fatura segura do
              Asaas. O novo plano é liberado assim que o pagamento for confirmado.
            </DialogDescription>
          </DialogHeader>
          {errors._ && <Alert variant="danger">{errors._}</Alert>}
          <Field id="bill-name" label="Nome completo ou razão social" error={errors.billingName}>
            {(p) => (
              <Input
                {...p}
                value={form.billingName}
                onChange={(e) => setForm({ ...form, billingName: e.target.value })}
                autoComplete="name"
              />
            )}
          </Field>
          <Field
            id="bill-doc"
            label="CPF ou CNPJ"
            error={errors.billingDocument}
            hint="Obrigatório para emitir a cobrança."
          >
            {(p) => (
              <Input
                {...p}
                inputMode="numeric"
                value={form.billingDocument}
                onChange={(e) => setForm({ ...form, billingDocument: e.target.value })}
              />
            )}
          </Field>
          <Field id="bill-phone" label="Celular (opcional)" error={errors.billingPhone}>
            {(p) => (
              <Input
                {...p}
                inputMode="tel"
                value={form.billingPhone}
                onChange={(e) => setForm({ ...form, billingPhone: e.target.value })}
                autoComplete="tel"
              />
            )}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" loading={m.isPending}>
              Ir para o pagamento <ExternalLink />
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------- downgrade / cancelamento ------------------------ */

interface Candidates {
  quizzes: { id: string; title: string; status: string; updatedAt: string; sessions: number }[];
  users: { id: string; name: string; email: string; role: string; lastLoginAt: string | null }[];
}

function DowngradeDialog({
  target,
  onClose,
  immediate,
}: {
  target: PlanWithPrice | null;
  onClose: () => void;
  immediate: boolean;
}) {
  const qc = useQueryClient();
  const { data } = useBilling();
  const [step, setStep] = useState<'loss' | 'select' | 'confirm'>('loss');
  const [quizIds, setQuizIds] = useState<string[]>([]);
  const [userIds, setUserIds] = useState<string[]>([]);
  const cands = useQuery({
    queryKey: ['removal-candidates'],
    queryFn: () => api<Candidates>('/account/removal-candidates'),
    enabled: !!target,
  });
  useEffect(() => {
    setStep('loss');
    setQuizIds([]);
    setUserIds([]);
  }, [target?.id]);

  const current = data?.plan;
  const needQuizzes =
    target && data
      ? Math.max(0, data.usage.quizzes - (target.effectiveLimits.maxQuizzes ?? Infinity))
      : 0;
  const needUsers =
    target && data ? Math.max(0, data.usage.users - target.effectiveLimits.maxUsers) : 0;
  const needSelection = needQuizzes > 0 || needUsers > 0;
  const losses = current && target ? lossesBetween(current, target) : [];
  const isCancel = target?.id === 'FREE';
  const when =
    immediate || !data?.currentPeriodEnd ? 'agora' : `em ${fmtDay(data.currentPeriodEnd)}`;

  const m = useMutation({
    mutationFn: () =>
      api<{ scheduled: boolean; effectiveAt: string }>(
        isCancel ? '/account/cancel' : '/account/plan',
        {
          body: isCancel
            ? { removeQuizIds: quizIds, removeUserIds: userIds }
            : { planId: target!.id, removeQuizIds: quizIds, removeUserIds: userIds },
        },
      ),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: BILLING_KEY });
      qc.invalidateQueries({ queryKey: ['quizzes'] });
      toast.success(
        r.scheduled
          ? `Tudo certo. A mudança acontece em ${fmtDay(r.effectiveAt)}.`
          : `Plano alterado para ${target!.name}.`,
      );
      onClose();
    },
    onError: (e) => toast.error(describeError(e)),
  });

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        {step === 'loss' && current && target && (
          <>
            <DialogHeader>
              <div className="mx-auto mb-2 grid size-14 place-items-center rounded-full bg-danger/10 text-danger">
                <HeartCrack className="size-7" aria-hidden />
              </div>
              <DialogTitle className="text-center text-xl">
                {isCancel ? 'Tem certeza que quer cancelar?' : `Voltar para o ${target.name}?`}
              </DialogTitle>
              <DialogDescription className="text-center">
                Você construiu muita coisa no plano {current.name}. Veja o que muda {when}:
              </DialogDescription>
            </DialogHeader>
            <ul className="grid gap-2">
              {losses.map((l) => (
                <li
                  key={l}
                  className="flex items-start gap-3 rounded-xl border border-danger/20 bg-danger/5 px-3 py-2.5 text-sm"
                >
                  <X className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden /> {l}
                </li>
              ))}
              {needSelection && (
                <li className="flex items-start gap-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2.5 text-sm">
                  <X className="mt-0.5 size-4 shrink-0 text-warning-strong" aria-hidden />
                  Para caber no {target.name}, você vai precisar excluir
                  {needQuizzes > 0 && ` ${needQuizzes} quiz(zes)`}
                  {needQuizzes > 0 && needUsers > 0 && ' e'}
                  {needUsers > 0 && ` ${needUsers} usuário(s)`} — com seus relatórios.
                </li>
              )}
            </ul>
            {!immediate && data?.currentPeriodEnd && (
              <p className="text-center text-sm text-muted-foreground">
                Você continua com tudo do plano {current.name} até{' '}
                <strong>{fmtDay(data.currentPeriodEnd)}</strong>.
              </p>
            )}
            <DialogFooter className="sm:justify-between">
              <Button
                variant="ghost"
                onClick={() => (needSelection ? setStep('select') : setStep('confirm'))}
              >
                {isCancel ? 'Quero cancelar mesmo assim' : 'Continuar com a mudança'}
              </Button>
              <Button onClick={onClose}>
                <Crown /> Manter o {current.name}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'select' && target && (
          <>
            <DialogHeader>
              <DialogTitle>Escolha o que será excluído</DialogTitle>
              <DialogDescription>
                O plano {target.name} permite{' '}
                {limitLabel(target.effectiveLimits.maxQuizzes, 'quizzes')} e{' '}
                {target.effectiveLimits.maxUsers} usuário(s). Os itens marcados serão excluídos{' '}
                {when}.
              </DialogDescription>
            </DialogHeader>
            {cands.isPending ? (
              <Skeleton className="h-40" />
            ) : (
              <div className="grid max-h-[50vh] gap-4 overflow-y-auto pr-1">
                {needQuizzes > 0 && (
                  <fieldset className="grid gap-2">
                    <legend className="mb-1 text-sm font-semibold">
                      Quizzes{' '}
                      <span
                        className={cn(
                          'font-normal',
                          quizIds.length >= needQuizzes ? 'text-success-strong' : 'text-danger',
                        )}
                      >
                        — selecione {needQuizzes} ({quizIds.length} marcados)
                      </span>
                    </legend>
                    {cands.data?.quizzes.map((q) => (
                      <label
                        key={q.id}
                        className="flex cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-2 text-sm has-[:checked]:border-danger has-[:checked]:bg-danger/5"
                      >
                        <input
                          type="checkbox"
                          className="size-4 accent-red-600"
                          checked={quizIds.includes(q.id)}
                          onChange={() => toggle(quizIds, setQuizIds, q.id)}
                        />
                        <span className="min-w-0 flex-1 truncate">{q.title}</span>
                        <span className="text-xs text-muted-foreground">
                          {q.sessions} sessão(ões)
                        </span>
                      </label>
                    ))}
                  </fieldset>
                )}
                {needUsers > 0 && (
                  <fieldset className="grid gap-2">
                    <legend className="mb-1 text-sm font-semibold">
                      Usuários{' '}
                      <span
                        className={cn(
                          'font-normal',
                          userIds.length >= needUsers ? 'text-success-strong' : 'text-danger',
                        )}
                      >
                        — selecione {needUsers} ({userIds.length} marcados)
                      </span>
                    </legend>
                    {cands.data?.users
                      .filter((u) => u.role !== 'OWNER')
                      .map((u) => (
                        <label
                          key={u.id}
                          className="flex cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-2 text-sm has-[:checked]:border-danger has-[:checked]:bg-danger/5"
                        >
                          <input
                            type="checkbox"
                            className="size-4 accent-red-600"
                            checked={userIds.includes(u.id)}
                            onChange={() => toggle(userIds, setUserIds, u.id)}
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {u.name} <span className="text-muted-foreground">· {u.email}</span>
                          </span>
                        </label>
                      ))}
                  </fieldset>
                )}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('loss')}>
                Voltar
              </Button>
              <Button
                disabled={quizIds.length < needQuizzes || userIds.length < needUsers}
                onClick={() => setStep('confirm')}
              >
                Continuar
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'confirm' && target && (
          <>
            <DialogHeader>
              <DialogTitle>
                {isCancel ? 'Confirmar cancelamento' : `Confirmar mudança para o ${target.name}`}
              </DialogTitle>
              <DialogDescription>
                {immediate
                  ? `A mudança é aplicada agora.`
                  : `Nada muda até ${fmtDay(data?.currentPeriodEnd ?? null)}. ${isCancel ? 'Não haverá novas cobranças.' : `Depois disso, a cobrança passa a ser de ${priceLabel(target)}.`}`}
                {(quizIds.length > 0 || userIds.length > 0) &&
                  ` Serão excluídos ${quizIds.length} quiz(zes) e ${userIds.length} usuário(s).`}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Desistir
              </Button>
              <Button variant="destructive" loading={m.isPending} onClick={() => m.mutate()}>
                {isCancel ? 'Cancelar plano' : 'Confirmar mudança'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------- página --------------------------------- */

export default function PlansPage() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const b = useBilling();
  const [checkoutPlan, setCheckoutPlan] = useState<PlanWithPrice | null>(null);
  const [downPlan, setDownPlan] = useState<PlanWithPrice | null>(null);
  const payments = useQuery({
    queryKey: ['account', 'payments'],
    queryFn: () => api<{ items: PaymentDto[] }>('/account/payments'),
  });
  const revert = useMutation({
    mutationFn: () => api('/account/plan/revert', { method: 'POST' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BILLING_KEY });
      toast.success('Mudança desfeita. Seu plano continua como está.');
    },
    onError: (e) => toast.error(describeError(e)),
  });

  // Aguardando pagamento: atualiza sozinho para liberar o plano sem recarregar
  const waiting = !!b.data?.checkoutPayment || b.data?.subscriptionStatus !== 'ACTIVE';
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => qc.invalidateQueries({ queryKey: BILLING_KEY }), 8000);
    return () => clearInterval(t);
  }, [waiting, qc]);

  const free = b.data?.plans.find((p) => p.id === 'FREE') ?? null;
  useEffect(() => {
    if (params.get('cancelar') && free && b.data?.plan.id !== 'FREE') {
      setDownPlan(free);
      setParams({}, { replace: true });
    }
  }, [params, free, b.data, setParams]);

  const others = useMemo(
    () => (b.data ? b.data.plans.filter((p) => p.id !== b.data.plan.id) : []),
    [b.data],
  );

  if (b.isPending) return <Skeleton className="h-96" />;
  if (b.isError)
    return (
      <ErrorState
        description={describeError(b.error)}
        action={<Button onClick={() => b.refetch()}>Tentar novamente</Button>}
      />
    );
  const d = b.data;
  const cur = d.plan;
  const frozen = d.subscriptionStatus === 'FROZEN';
  const rank = (id: string) => PLAN_RANK[id as PlanId];

  return (
    <>
      <PageHeader
        title="Planos"
        description="Seu plano atual, o que ele inclui e as opções para crescer."
      />
      {!d.isOwner && <Alert className="mb-4">Somente o dono da conta pode alterar o plano.</Alert>}

      {d.checkoutPayment && (
        <Alert variant="info" className="mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
            <span className="flex-1">
              Aguardando o pagamento de <strong>{formatBRL(d.checkoutPayment.amountCents)}</strong>{' '}
              para ativar o plano{' '}
              <strong>{d.plans.find((p) => p.id === d.checkoutPayment!.planId)?.name}</strong>. A
              página atualiza sozinha.
            </span>
            {d.checkoutPayment.invoiceUrl && (
              <Button asChild size="sm">
                <a href={d.checkoutPayment.invoiceUrl} target="_blank" rel="noreferrer">
                  Abrir fatura <ExternalLink />
                </a>
              </Button>
            )}
          </div>
        </Alert>
      )}
      {d.pendingPlanId && (
        <Alert variant="warning" className="mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <Clock className="size-4" aria-hidden />
            <span className="flex-1">
              Em <strong>{fmtDay(d.pendingChangeAt)}</strong> seu plano muda para{' '}
              <strong>{d.plans.find((p) => p.id === d.pendingPlanId)?.name}</strong>
              {d.pendingRemovals.quizIds.length + d.pendingRemovals.userIds.length > 0 &&
                ` e ${d.pendingRemovals.quizIds.length} quiz(zes) e ${d.pendingRemovals.userIds.length} usuário(s) serão excluídos`}
              .
            </span>
            {d.isOwner && (
              <Button
                size="sm"
                variant="outline"
                loading={revert.isPending}
                onClick={() => revert.mutate()}
              >
                <RotateCcw /> Manter meu plano
              </Button>
            )}
          </div>
        </Alert>
      )}
      {d.openPayment && d.subscriptionStatus !== 'ACTIVE' && (
        <Alert variant="danger" className="mb-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex-1">
              {frozen ? 'Conta congelada: ' : 'Fatura em atraso: '}
              {formatBRL(d.openPayment.amountCents)} com vencimento em{' '}
              {fmtDay(d.openPayment.dueDate)}.
            </span>
            {d.openPayment.invoiceUrl && (
              <Button asChild size="sm" variant="destructive">
                <a href={d.openPayment.invoiceUrl} target="_blank" rel="noreferrer">
                  Pagar agora
                </a>
              </Button>
            )}
          </div>
        </Alert>
      )}

      {/* Plano atual */}
      <Card className="relative mb-8 overflow-hidden border-primary/40">
        <div
          className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-primary via-violet-500 to-primary"
          aria-hidden
        />
        <CardContent className="grid gap-6 pt-6 md:grid-cols-[1.2fr_1fr]">
          <div className="grid gap-3">
            <Badge className="w-fit">Seu plano atual</Badge>
            <h2 className="flex items-center gap-2 text-3xl font-bold">
              {cur.id === 'YEARLY' ? (
                <Crown className="size-7 text-amber-500" aria-hidden />
              ) : (
                <Sparkles className="size-7 text-primary" aria-hidden />
              )}
              {cur.name}
            </h2>
            <p className="text-lg font-semibold">
              {d.billingExempt ? 'Cortesia' : priceLabel(cur)}
            </p>
            {d.currentPeriodEnd && !d.billingExempt && (
              <p className="text-sm text-muted-foreground">
                {d.pendingPlanId ? 'Válido até' : 'Próxima renovação'}: {fmtDay(d.currentPeriodEnd)}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-muted p-3">
                <p className="text-xs text-muted-foreground">Quizzes</p>
                <p className="font-display text-xl font-bold tabular-nums">
                  {d.usage.quizzes}
                  <span className="text-sm font-normal text-muted-foreground">
                    /{cur.effectiveLimits.maxQuizzes ?? '∞'}
                  </span>
                </p>
              </div>
              <div className="rounded-xl bg-muted p-3">
                <p className="text-xs text-muted-foreground">Usuários</p>
                <p className="font-display text-xl font-bold tabular-nums">
                  {d.usage.users}
                  <span className="text-sm font-normal text-muted-foreground">
                    /{cur.effectiveLimits.maxUsers}
                  </span>
                </p>
              </div>
            </div>
          </div>
          <div className="grid content-start gap-3">
            <p className="text-sm font-semibold">O que você tem hoje</p>
            <PlanFeatures plan={cur} />
          </div>
        </CardContent>
      </Card>

      {/* Outros planos */}
      <h2 className="mb-3 text-lg font-semibold">Outros planos</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {others.map((p) => {
          const up = rank(p.id) > rank(cur.id);
          const pending = d.checkoutPayment?.planId === p.id;
          return (
            <Card key={p.id} className={cn('flex flex-col', up && 'border-primary/30 shadow-md')}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl">{p.name}</CardTitle>
                  {up && p.id === 'YEARLY' && (
                    <Badge variant="accent">Melhor custo-benefício</Badge>
                  )}
                </div>
                <p className="text-2xl font-bold">{priceLabel(p)}</p>
                {p.interval === 'YEARLY' && p.effectivePriceCents > 0 && (
                  <p className="text-xs text-muted-foreground">
                    equivale a {formatBRL(Math.round(p.effectivePriceCents / 12))}/mês
                  </p>
                )}
                {p.description && <p className="text-sm text-muted-foreground">{p.description}</p>}
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-5">
                <PlanFeatures plan={p} />
                <div className="mt-auto">
                  {up ? (
                    <Button
                      className="w-full"
                      size="lg"
                      disabled={!d.isOwner || frozen}
                      onClick={() => setCheckoutPlan(p)}
                    >
                      {pending ? 'Continuar pagamento' : `Fazer upgrade para ${p.name}`}
                    </Button>
                  ) : (
                    <Button
                      className="w-full"
                      variant="outline"
                      disabled={!d.isOwner || d.pendingPlanId === p.id}
                      onClick={() => setDownPlan(p)}
                    >
                      {d.pendingPlanId === p.id
                        ? 'Mudança agendada'
                        : p.id === 'FREE'
                          ? 'Voltar ao Gratuito'
                          : `Mudar para ${p.name}`}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {frozen && (
        <p className="mt-3 text-sm text-muted-foreground">
          Com a conta congelada, regularize a fatura ou volte ao Gratuito para liberar o painel.
        </p>
      )}

      {cur.id !== 'FREE' && d.isOwner && !d.pendingPlanId && free && (
        <div className="mt-6 text-center">
          <Button
            variant="link"
            className="text-muted-foreground"
            onClick={() => setDownPlan(free)}
          >
            Cancelar plano
          </Button>
        </div>
      )}

      {/* Histórico */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Histórico de pagamentos</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {!payments.data || payments.data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma cobrança até agora.</p>
          ) : (
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2">
                    Descrição
                  </th>
                  <th scope="col" className="py-2">
                    Vencimento
                  </th>
                  <th scope="col" className="py-2">
                    Pago em
                  </th>
                  <th scope="col" className="py-2 text-right">
                    Valor
                  </th>
                  <th scope="col" className="py-2">
                    Situação
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {payments.data.items.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2">{p.description}</td>
                    <td className="py-2">{fmtDay(p.dueDate)}</td>
                    <td className="py-2">{p.paidAt ? formatDateTime(p.paidAt) : '—'}</td>
                    <td className="py-2 text-right tabular-nums">{formatBRL(p.amountCents)}</td>
                    <td className="py-2">
                      <span className="inline-flex items-center gap-1.5">
                        {(p.status === 'RECEIVED' || p.status === 'CONFIRMED') && (
                          <CheckCircle2 className="size-4 text-success" aria-hidden />
                        )}
                        {PAYMENT_STATUS_LABELS[p.status]}
                        {(p.status === 'PENDING' || p.status === 'OVERDUE') && p.invoiceUrl && (
                          <a
                            className="text-primary underline"
                            href={p.invoiceUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            pagar
                          </a>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <CheckoutDialog plan={checkoutPlan} onClose={() => setCheckoutPlan(null)} />
      <DowngradeDialog
        target={downPlan}
        immediate={frozen || d.billingExempt || !d.currentPeriodEnd}
        onClose={() => setDownPlan(null)}
      />
    </>
  );
}
